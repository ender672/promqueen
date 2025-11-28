#!/usr/bin/env node

const fs = require('fs');
const process = require('process');
const eventsourceParser = require('eventsource-parser');
const commander = require('commander');
const pqutils = require('./lib/pqutils.js');
const console = require('console');
const path = require('path');
const yaml = require('js-yaml');

let logger = null;

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
    for await (const event of getStream(response)) {
      if (event.data === '[DONE]') {
        break;
      }

      const json = JSON.parse(event.data);
      if (logger && fullConfig.pricing && json.usage) {
        logger.info(usageToCostString(fullConfig.pricing, json.usage));
      }

      let content = json.choices[0]?.delta?.content || '';
      if (content && isFirstEvent) {
        isFirstEvent = false;
        if (content[0] == "\n") {
          content = content.slice(1);
        }
      }
      if (content) {
        outputStream.write(content);
      }
    }
  } else {
    const json = await response.json();
    if (logger && fullConfig.pricing && json.usage) {
      logger.info(usageToCostString(fullConfig.pricing, json.usage));
    }
    const content = json.choices?.[0]?.message?.content || '';
    outputStream.write(content);
  }
}

async function sendPrompt(prompt, cwd, outputStream = process.stdout, errorStream = process.stderr, cliConfig = {}) {
  const { config: runtimeConfig, messages } = pqutils.parseConfigAndMessages(prompt);
  const config = pqutils.resolveConfig(runtimeConfig, cwd, cliConfig);

  if (config.debug_log_path) {
    const basePath = path.join(config.debug_log_path, 'sendprompt');
    logger = pqutils.getLogger(basePath);
  }

  const promptMessages = messages.map(message => {
    return {
      role: message.name,
      content: message.content
    }
  });

  const lastMessage = promptMessages.at(-1);
  if (lastMessage && lastMessage.role === 'assistant') {
    lastMessage.prefix = true;
  }

  const body = {
    ...config.api_call_props,
    messages: promptMessages,
  }
  if (logger) {
    // logger.info(prompt);
    // logger.info(JSON.stringify(body, null, 2));
  }
  const response = await fetch(config.api_url, {
    method: 'POST',
    headers: config.api_call_headers,
    body: JSON.stringify(body),
  });
  await responseToOutput(response, config, outputStream, errorStream);
}

async function main() {
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
      const configContent = fs.readFileSync(options.config, 'utf8');
      cliConfig = yaml.load(configContent) || {};
    } catch (e) {
      console.error(`Error loading config file: ${e.message}`);
      process.exit(1);
    }
  }

  let prompt = options.expression;
  if (filePath && filePath !== '-') {
    prompt = fs.readFileSync(filePath, 'utf8');
  } else if (!prompt) {
    prompt = fs.readFileSync(0, 'utf-8');
  }
  await sendPrompt(prompt, process.cwd(), process.stdout, process.stderr, cliConfig);
}

if (require.main === module) {
  main();
}

module.exports = { sendPrompt };
