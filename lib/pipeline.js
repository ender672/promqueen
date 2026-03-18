const fs = require('fs');
const path = require('path');
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
const { expandCBS } = require('./render-template.js');

function prepareTurn(messages, resolvedConfig, templateLoaderPath, promptFilePath) {
    const msgs = structuredClone(messages);
    precompletionLint(msgs, resolvedConfig, templateLoaderPath);
    const nextEntry = msgs[msgs.length - 1];
    const apiMessages = preparePrompt(msgs, resolvedConfig, templateLoaderPath, templateLoaderPath, promptFilePath);
    return { apiMessages, nextEntry };
}

function preparePrompt(messages, resolvedConfig, templateLoaderPath, cwd, promptFilePath) {
    let lorebookPath = resolveLorebookPath(resolvedConfig, templateLoaderPath);
    if (!lorebookPath) {
        const defaultPath = path.resolve(templateLoaderPath, 'character_book.json');
        if (fs.existsSync(defaultPath)) lorebookPath = defaultPath;
    }

    let apiMessages = structuredClone(messages);
    let lorebook;
    let cardData;
    if (lorebookPath) {
        lorebook = JSON.parse(fs.readFileSync(lorebookPath, 'utf8'));
    } else if (resolvedConfig.charcard) {
        const charcardPath = path.resolve(templateLoaderPath, resolvedConfig.charcard);
        if (fs.existsSync(charcardPath)) {
            cardData = extractAiCardData(charcardPath);
            lorebook = cardData.character_book;
        }
    }
    if (lorebook) {
        apiMessages = applyLorebook(apiMessages, resolvedConfig, lorebook, { promptFilePath });
    }

    // Pull post_history_instructions from charcard if not already set in config
    if (!resolvedConfig.post_history_instructions && resolvedConfig.charcard) {
        if (!cardData) {
            const charcardPath = path.resolve(templateLoaderPath, resolvedConfig.charcard);
            if (fs.existsSync(charcardPath)) {
                cardData = extractAiCardData(charcardPath);
            }
        }
        if (cardData && cardData.post_history_instructions) {
            const cbsVars = { original: '', char: cardData.name, user: resolvedConfig.roleplay_user };
            const expanded = expandCBS(cardData.post_history_instructions, cbsVars);
            resolvedConfig = { ...resolvedConfig, post_history_instructions: expanded };
        }
    }

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
