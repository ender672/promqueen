const fs = require('fs');
const process = require('process');
const eventsourceParser = require('eventsource-parser');
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
    const cachedTokens = usage.cache_read_input_tokens || 0;
    const promptTokens = usage.input_tokens;
    const costUncached = (promptTokens - cachedTokens) / 1000000 * pricing.cost_uncached;
    const costCached = cachedTokens / 1000000 * pricing.cost_cached;
    const costOutput = usage.output_tokens / 1000000 * pricing.cost_output;
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
            if (event.event === 'message_stop') {
                break;
            }

            const json = JSON.parse(event.data);

            if (fullConfig.pricing && json.usage) {
                const costString = usageToCostString(fullConfig.pricing, json.usage);
                errorStream.write(costString + '\n');
            }

            if (event.event !== 'content_block_delta') {
                continue;
            }

            let content = json.delta?.text || '';
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
        let content = json.content?.[0]?.text || '';
        content = content.replace(/\{\{/g, '\\{{');
        content = content.replace(/\{%/g, '\\{%');
        content = content.replace(/^@/gm, '\\@');
        outputStream.write(content);
    }
}

async function sendPromptAnthropic(messages, resolvedConfig, outputStream = process.stdout, errorStream = process.stderr, options = {}) {
    const promptMessages = messages.map(message => {
        let content = message.content;
        if (content) {
            content = content.replace(/\\\{\{/g, '{{');
            content = content.replace(/\\\{%/g, '{%');
            content = content.replace(/^\\@/gm, '@');
        }
        return {
            role: message.role,
            content: content
        }
    });

    // Extract system messages into a top-level system parameter
    const systemMessages = promptMessages.filter(m => m.role === 'system');
    const nonSystemMessages = promptMessages.filter(m => m.role !== 'system');

    const lastMessage = nonSystemMessages.at(-1);
    if (lastMessage && lastMessage.role === 'assistant') {
        if (!lastMessage.content) {
            nonSystemMessages.pop();
        }
    }

    const body = {
        ...resolvedConfig.api_call_props,
        messages: nonSystemMessages,
    };

    if (systemMessages.length > 0) {
        body.system = systemMessages.map(m => m.content).join('\n\n');
    }

    if (resolvedConfig.debug_log_path) {
        const debugDir = path.resolve(resolvedConfig.debug_log_path);
        if (!fs.existsSync(debugDir)) {
            fs.mkdirSync(debugDir, { recursive: true });
        }
        const debugPath = path.join(debugDir, 'last_request_payload.json');
        fs.writeFileSync(debugPath, JSON.stringify(body, null, 2));
    }
    const response = await fetch(resolvedConfig.api_url, {
        method: 'POST',
        headers: resolvedConfig.api_call_headers,
        body: JSON.stringify(body),
        signal: options.signal,
    });
    await responseToOutput(response, resolvedConfig, outputStream, errorStream);
}

module.exports = { sendPromptAnthropic };
