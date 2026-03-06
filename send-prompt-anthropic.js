const process = require('process');
const {
    getStream, unescapeMessages, escapeContent, escapeContentBlock,
    calculatePricing, pricingToString, debugLogBody, sendRequest,
} = require('./lib/send-prompt-common.js');

function usageToPricing(pricing, usage) {
    const cachedTokens = usage.cache_read_input_tokens || 0;
    return calculatePricing(pricing, usage.input_tokens, cachedTokens, usage.output_tokens);
}

async function responseToOutput(response, fullConfig, outputStream) {
    const contentType = response.headers.get('content-type');
    const isStreaming = contentType && contentType.includes('text/event-stream');
    let pricingResult = null;

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
                pricingResult = usageToPricing(fullConfig.pricing, json.usage);
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
                const escaped = escapeContent(content, lastCharWasNewline);
                content = escaped.content;
                lastCharWasNewline = escaped.lastCharWasNewline;
                if (content) {
                    outputStream.write(content);
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
        let content = json.content?.[0]?.text || '';
        outputStream.write(escapeContentBlock(content));
    }

    return pricingResult;
}

async function sendPromptAnthropic(messages, resolvedConfig, outputStream = process.stdout, options = {}) {
    const promptMessages = unescapeMessages(messages);

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

    debugLogBody(resolvedConfig, body);
    const response = await sendRequest(resolvedConfig, body, options);
    return await responseToOutput(response, resolvedConfig, outputStream);
}

module.exports = { sendPromptAnthropic, pricingToString };
