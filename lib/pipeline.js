const fs = require('fs');
const path = require('path');
const { applyTemplate } = require('../apply-template.js');
const { applyLorebook, resolveLorebookPath } = require('../apply-lorebook.js');
const { injectInstructions } = require('../inject-instructions.js');
const { formatNames } = require('../format-names.js');
const { combineAdjacentMessages } = require('../combine-messages.js');
const { sendPrompt } = require('../send-prompt.js');
const { sendPromptAnthropic } = require('../send-prompt-anthropic.js');
const { sendRawPrompt } = require('../send-raw-prompt.js');
const { getConnectionProfile } = require('./pq-utils.js');
const { precompletionLint } = require('../pre-completion-lint.js');
const { extractAiCardData } = require('./card-utils.js');

function prepareTurn(messages, resolvedConfig, templateLoaderPath) {
    const msgs = structuredClone(messages);
    precompletionLint(msgs, resolvedConfig, templateLoaderPath);
    const assistantEntry = msgs[msgs.length - 1];
    const assistantName = assistantEntry.name;
    const assistantRole = assistantEntry.role || 'assistant';
    const apiMessages = preparePrompt(msgs, resolvedConfig, templateLoaderPath, templateLoaderPath);
    return { apiMessages, assistantName, assistantRole };
}

function preparePrompt(messages, resolvedConfig, templateLoaderPath, cwd) {
    let lorebookPath = resolveLorebookPath(resolvedConfig, templateLoaderPath);
    if (!lorebookPath) {
        const defaultPath = path.resolve(templateLoaderPath, 'character_book.json');
        if (fs.existsSync(defaultPath)) lorebookPath = defaultPath;
    }

    let apiMessages = structuredClone(messages);
    if (lorebookPath) {
        let lorebook;
        if (lorebookPath.endsWith('.png')) {
            const cardData = extractAiCardData(lorebookPath);
            lorebook = cardData.character_book;
        } else {
            lorebook = JSON.parse(fs.readFileSync(lorebookPath, 'utf8'));
        }
        if (lorebook) {
            apiMessages = applyLorebook(apiMessages, resolvedConfig, lorebook);
        }
    }

    apiMessages = applyTemplate(apiMessages, resolvedConfig, {
        messageTemplateLoaderPath: templateLoaderPath, cwd
    });

    apiMessages = injectInstructions(apiMessages, resolvedConfig, cwd);
    apiMessages = formatNames(apiMessages, resolvedConfig);
    apiMessages = combineAdjacentMessages(apiMessages);
    return apiMessages;
}

function dispatchSendPrompt(apiMessages, resolvedConfig, outputStream, templateLoaderPath, options = {}) {
    const apiUrl = getConnectionProfile(resolvedConfig).api_url;
    if (apiUrl.endsWith('/v1/completions')) {
        return sendRawPrompt(apiMessages, resolvedConfig, outputStream, templateLoaderPath, options);
    } else if (apiUrl.includes('anthropic.com')) {
        return sendPromptAnthropic(apiMessages, resolvedConfig, outputStream, options);
    } else {
        return sendPrompt(apiMessages, resolvedConfig, outputStream, options);
    }
}

module.exports = { prepareTurn, preparePrompt, dispatchSendPrompt };
