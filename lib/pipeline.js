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

function preparePrompt(messages, resolvedConfig, templateLoaderPath, cwd) {
    let lorebookPath = resolveLorebookPath(resolvedConfig, templateLoaderPath);
    if (!lorebookPath) {
        const defaultPath = path.resolve(templateLoaderPath, 'character_book.json');
        if (fs.existsSync(defaultPath)) lorebookPath = defaultPath;
    }

    let apiMessages = structuredClone(messages);
    if (lorebookPath) {
        const lorebook = JSON.parse(fs.readFileSync(lorebookPath, 'utf8'));
        apiMessages = applyLorebook(apiMessages, resolvedConfig, lorebook);
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

module.exports = { preparePrompt, dispatchSendPrompt };
