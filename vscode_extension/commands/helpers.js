const fs = require('fs');
const path = require('path');
const { applyTemplate } = require('../../applytemplate.js');
const { applyLorebook, resolveLorebookPath } = require('../../apply-lorebook.js');
const { rpToPrompt } = require('../../rptoprompt.js');
const { applyExtraInstructions } = require('../../apply-extra-instructions.js');

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

    apiMessages = rpToPrompt(apiMessages, resolvedConfig, projectRoot);
    return applyExtraInstructions(apiMessages);
}

module.exports = { getDocumentText, preparePrompt };
