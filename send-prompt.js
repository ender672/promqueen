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

function usageToPricing(pricing, usage) {
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

    return {
        costTotal,
        requestsPerPenny,
        costUncached,
        costCached,
        costOutput,
        cachedPercentage,
        promptTokens,
        cachedTokens,
        completionTokens: usage["completion_tokens"],
    };
}

function pricingToString(p) {
    return `total cost: ${p.costTotal.toFixed(5)}¢, requests/penny: ${p.requestsPerPenny.toFixed(2)}, uncached in: ${p.costUncached.toFixed(5)}¢, cached in: ${p.costCached.toFixed(5)}¢, output: ${p.costOutput.toFixed(5)}¢, ${p.cachedPercentage.toFixed(1)}% cached`;
}

async function responseToOutput(response, fullConfig, outputStream) {
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }

    const contentType = response.headers.get('content-type');
    const isStreaming = contentType && contentType.includes('text/event-stream');
    let pricingResult = null;

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
                pricingResult = usageToPricing(fullConfig.pricing, json.usage);
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
            pricingResult = usageToPricing(fullConfig.pricing, json.usage);
        }
        let content = json.choices?.[0]?.message?.content || '';
        content = content.replace(/\{\{/g, '\\{{');
        content = content.replace(/\{%/g, '\\{%');
        content = content.replace(/^@/gm, '\\@');
        outputStream.write(content);
    }

    return pricingResult;
}

async function sendPrompt(messages, resolvedConfig, outputStream = process.stdout, options = {}) {
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
        ...resolvedConfig.api_call_props,
        messages: promptMessages,
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
    return await responseToOutput(response, resolvedConfig, outputStream);
}

module.exports = { sendPrompt, pricingToString };
