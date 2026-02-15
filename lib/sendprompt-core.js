const fs = require('fs');
const process = require('process');
const eventsourceParser = require('eventsource-parser');
const pqutils = require('./pqutils.js');
const console = require('console');
const path = require('path');
const yaml = require('js-yaml');

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
                outputStream.write(content);
            }
        }
    } else {
        const json = await response.json();
        if (fullConfig.pricing && json.usage) {
            const costString = usageToCostString(fullConfig.pricing, json.usage);
            errorStream.write(costString + '\n');
        }
        const content = json.choices?.[0]?.message?.content || '';
        outputStream.write(content);
    }
}

async function sendPrompt(prompt, cwd, outputStream = process.stdout, errorStream = process.stderr, cliConfig = {}) {
    const { config: runtimeConfig, messages } = pqutils.parseConfigAndMessages(prompt);
    const config = pqutils.resolveConfig(runtimeConfig, cwd, cliConfig);


    const promptMessages = messages.map(message => {
        return {
            role: message.name,
            content: message.content
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
    });
    await responseToOutput(response, config, outputStream, errorStream);
}

module.exports = { sendPrompt };
