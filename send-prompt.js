const process = require('process');
const {
    getStream, unescapeMessages, escapeContent, escapeContentBlock,
    calculatePricing, pricingToString, debugLogBody, debugLogFinalPqueen, sendRequest,
} = require('./lib/send-prompt-common.js');
const { getConnectionProfile } = require('./lib/pq-utils.js');

function usageToPricing(pricing, usage) {
    const cachedTokens = usage["prompt_tokens_details"]?.["cached_tokens"] || 0;
    return calculatePricing(pricing, usage["prompt_tokens"], cachedTokens, usage["completion_tokens"]);
}

async function responseToOutput(response, connProfile, outputStream) {
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
            if (connProfile.pricing && json.usage) {
                pricingResult = usageToPricing(connProfile.pricing, json.usage);
            }

            let content = json.choices?.[0]?.delta?.content || '';
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
        if (connProfile.pricing && json.usage) {
            pricingResult = usageToPricing(connProfile.pricing, json.usage);
        }
        let content = json.choices?.[0]?.message?.content || '';
        outputStream.write(escapeContentBlock(content));
    }

    return pricingResult;
}

async function sendPrompt(messages, resolvedConfig, outputStream = process.stdout, options = {}) {
    const connProfile = getConnectionProfile(resolvedConfig);
    const promptMessages = unescapeMessages(messages);

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
        ...connProfile.api_call_props,
        messages: promptMessages,
    };
    if (body.stream && connProfile.pricing) {
        body.stream_options = { include_usage: true };
    }
    debugLogFinalPqueen(resolvedConfig, messages);
    debugLogBody(resolvedConfig, body);
    const response = await sendRequest(connProfile, body, options);
    return await responseToOutput(response, connProfile, outputStream);
}

module.exports = { sendPrompt, pricingToString };
