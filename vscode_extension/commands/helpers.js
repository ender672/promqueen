const fs = require('fs');
const path = require('path');
const { applyTemplate } = require('../../apply-template.js');
const { applyLorebook, resolveLorebookPath } = require('../../apply-lorebook.js');
const { injectInstructions } = require('../../inject-instructions.js');
const { formatNames } = require('../../format-names.js');

function getDocumentText(document) {
    return document.getText().replace(/\r\n/g, '\n');
}

function preparePrompt(messages, resolvedConfig, templateLoaderPath, projectRoot) {
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
        messageTemplateLoaderPath: templateLoaderPath,
        cwd: projectRoot
    });

    apiMessages = injectInstructions(apiMessages, resolvedConfig, projectRoot);
    apiMessages = formatNames(apiMessages, resolvedConfig);
    return apiMessages;
}

module.exports = { getDocumentText, preparePrompt };
