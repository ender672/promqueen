const fs = require('fs');
const process = require('process');
const { Parser, Context } = require('@ender672/minja-js/minja');
const path = require('path');
const {
    getStream, unescapeMessages, escapeContent, escapeContentBlock,
    calculatePricing, pricingToString, debugLogBody, sendRequest,
} = require('./lib/send-prompt-common.js');

function usageToPricing(pricing, usage) {
    const cachedTokens = usage["prompt_tokens_details"]["cached_tokens"];
    return calculatePricing(pricing, usage["prompt_tokens"], cachedTokens, usage["completion_tokens"]);
}

function applyChatTemplate(messages, templateString, config) {
    const trimmedMessages = messages.map(m => ({
        ...m,
        content: typeof m.content === 'string' ? m.content.trim() : m.content
    }));

    const lastMsg = trimmedMessages.at(-1);
    const addGenerationPrompt = !(lastMsg && lastMsg.role === 'assistant' && lastMsg.content);

    const bos_token = config.bos_token || '<s>';
    const eos_token = config.eos_token || '</s>';

    const root = Parser.parse(templateString);
    const ctx = Context.make({
        messages: trimmedMessages,
        add_generation_prompt: addGenerationPrompt,
        bos_token,
        eos_token,
    });
    return root.render(ctx);
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
            if (event.data === '[DONE]') {
                break;
            }

            const json = JSON.parse(event.data);
            if (fullConfig.pricing && json.usage) {
                pricingResult = usageToPricing(fullConfig.pricing, json.usage);
            }

            let content = json.choices[0]?.text || '';
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
        let content = json.choices?.[0]?.text || '';
        outputStream.write(escapeContentBlock(content));
    }

    return pricingResult;
}

async function sendRawPrompt(messages, resolvedConfig, outputStream = process.stdout, fileBasePath = process.cwd(), options = {}) {
    const chatTemplatePath = resolvedConfig.chat_template_path;
    if (!chatTemplatePath) {
        throw new Error('chat_template_path is required for sendrawprompt (set via --chat-template, config file, or frontmatter)');
    }

    const templateString = fs.readFileSync(path.resolve(fileBasePath, chatTemplatePath), 'utf8');

    const promptMessages = unescapeMessages(messages);

    const lastMessage = promptMessages.at(-1);
    if (lastMessage && lastMessage.role === 'assistant') {
        if (!lastMessage.content) {
            promptMessages.pop();
        }
    }

    const promptString = applyChatTemplate(promptMessages, templateString, resolvedConfig);

    const body = {
        ...resolvedConfig.api_call_props,
        prompt: promptString,
    };
    debugLogBody(resolvedConfig, body);
    const response = await sendRequest(resolvedConfig, body, options);
    return await responseToOutput(response, resolvedConfig, outputStream);
}

module.exports = { sendRawPrompt, pricingToString };
