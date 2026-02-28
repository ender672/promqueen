#!/usr/bin/env node

const fs = require('fs');
const process = require('process');
const yaml = require('js-yaml');
const eventsourceParser = require('eventsource-parser');
const pqutils = require('./lib/pqutils.js');
const path = require('path');

async function* getStream(response) {
    const decoder = new TextDecoder('utf-8');
    let eventsToYield = [];

    const parser = eventsourceParser.createParser({
        onEvent: (event) => {
            eventsToYield.push(event);
        }
    });

    for await (const chunk of response.body) {
        const textChunk = decoder.decode(chunk, { stream: true });
        parser.feed(textChunk);

        for (const event of eventsToYield) {
            yield event;
        }

        eventsToYield = [];
    }
}

function usageToCostString(pricing, usage) {
    const cachedTokens = usage["prompt_tokens_details"]["cached_tokens"];
    const promptTokens = usage["prompt_tokens"];
    const costUncached = (promptTokens - cachedTokens) / 1000000 * pricing.cost_uncached;
    const costCached = cachedTokens / 1000000 * pricing.cost_cached;
    const costOutput = usage["completion_tokens"] / 1000000 * pricing.cost_output;
    const costTotal = costUncached + costCached + costOutput;
    const requestsPerPenny = 1 / costTotal;

    let cachedPercentage = 0;
    if (promptTokens > 0) {
        cachedPercentage = (cachedTokens / promptTokens) * 100;
    }

    return `total cost: ${costTotal.toFixed(5)}¢, requests/penny: ${requestsPerPenny.toFixed(2)}, uncached in: ${costUncached.toFixed(5)}¢, cached in: ${costCached.toFixed(5)}¢, output: ${costOutput.toFixed(5)}¢, ${cachedPercentage.toFixed(1)}% cached`;
}

async function responseToOutput(response, fullConfig, outputStream, errorStream) {
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }

    const contentType = response.headers.get('content-type');
    const isStreaming = contentType && contentType.includes('text/event-stream');

    if (isStreaming) {
        let isFirstEvent = true;
        let lastCharWasNewline = false;
        let pendingBrace = false;
        for await (const event of getStream(response)) {
            if (event.data === '[DONE]') {
                break;
            }

            const json = JSON.parse(event.data);
            if (fullConfig.pricing && json.usage) {
                const costString = usageToCostString(fullConfig.pricing, json.usage);
                errorStream.write(costString + '\n');
            }

            let content = json.choices[0]?.delta?.content || '';
            if (content && isFirstEvent) {
                isFirstEvent = false;
                if (content[0] == "\n" || content[0] == " ") {
                    content = content.slice(1);
                }
            }
            if (content) {
                if (pendingBrace) {
                    content = '{' + content;
                    pendingBrace = false;
                }
                if (content.endsWith('{')) {
                    content = content.slice(0, -1);
                    pendingBrace = true;
                }
                content = content.replace(/\{\{/g, '\\{{');
                content = content.replace(/\{%/g, '\\{%');
                content = content.replace(/\n@/g, '\n\\@');
                if (lastCharWasNewline && content[0] === '@') {
                    content = '\\' + content;
                }
                if (content) {
                    outputStream.write(content);
                    lastCharWasNewline = content.endsWith('\n');
                }
            }
        }
        if (pendingBrace) {
            outputStream.write('{');
        }
    } else {
        const json = await response.json();
        if (fullConfig.pricing && json.usage) {
            const costString = usageToCostString(fullConfig.pricing, json.usage);
            errorStream.write(costString + '\n');
        }
        let content = json.choices?.[0]?.message?.content || '';
        content = content.replace(/\{\{/g, '\\{{');
        content = content.replace(/\{%/g, '\\{%');
        content = content.replace(/^@/gm, '\\@');
        outputStream.write(content);
    }
}

async function sendPrompt(prompt, cwd, outputStream = process.stdout, errorStream = process.stderr, cliConfig = {}, options = {}) {
    const { config: runtimeConfig, messages } = pqutils.parseConfigAndMessages(prompt);
    const config = pqutils.resolveConfig(runtimeConfig, cwd, cliConfig);


    const promptMessages = messages.map(message => {
        let content = message.content;
        if (content) {
            content = content.replace(/\\\{\{/g, '{{');
            content = content.replace(/\\\{%/g, '{%');
            content = content.replace(/^\\@/gm, '@');
        }
        return {
            role: message.name,
            content: content
        }
    });

    const lastMessage = promptMessages.at(-1);
    if (lastMessage && lastMessage.role === 'assistant') {
        if (lastMessage.content) {
            lastMessage.prefix = true; // deepseek beta
            lastMessage.partial = true; // Moonshotai kimi
        } else {
            promptMessages.pop();
        }
    }

    const body = {
        ...config.api_call_props,
        messages: promptMessages,
    }
    if (config.debug_log_path) {
        const debugDir = path.resolve(config.debug_log_path);
        if (!fs.existsSync(debugDir)) {
            fs.mkdirSync(debugDir, { recursive: true });
        }
        const debugPath = path.join(debugDir, 'last_request_payload.json');
        fs.writeFileSync(debugPath, JSON.stringify(body, null, 2));
    }
    const response = await fetch(config.api_url, {
        method: 'POST',
        headers: config.api_call_headers,
        body: JSON.stringify(body),
        signal: options.signal,
    });
    await responseToOutput(response, config, outputStream, errorStream);
}

async function main() {
  const commander = require('commander');
  commander.program.description('Send a prompt to an LLM.');
  commander.program.argument('[prompt_path]', 'Path to the prompt file.');
  commander.program.option('-e, --expression <string>', 'Inline prompt string');
  commander.program.option('-c, --config <path>', 'Path to a YAML config file');
  commander.program.parse(process.argv);
  const [filePath] = commander.program.args;
  const options = commander.program.opts();

  let cliConfig = {};
  if (options.config) {
    try {
      const configContent = fs.readFileSync(options.config, 'utf8').replace(/\r\n/g, '\n');
      cliConfig = yaml.load(configContent) || {};
    } catch (e) {
      console.error(`Error loading config file: ${e.message}`);
      process.exit(1);
    }
  }

  let prompt = options.expression;
  if (filePath && filePath !== '-') {
    prompt = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  } else if (!prompt) {
    prompt = fs.readFileSync(0, 'utf-8').replace(/\r\n/g, '\n');
  }
  await sendPrompt(prompt, process.cwd(), process.stdout, process.stderr, cliConfig);
}

if (require.main === module) {
  main();
}

module.exports = { sendPrompt };
