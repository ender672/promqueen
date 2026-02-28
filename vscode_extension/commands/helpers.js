const fs = require('fs');
const path = require('path');
const { applyTemplate } = require('../../applytemplate.js');
const { applyLorebook, resolveLorebookPath } = require('../../apply-lorebook.js');
const { rpToPrompt } = require('../../rptoprompt.js');

function getDocumentText(document) {
    return document.getText().replace(/\r\n/g, '\n');
}

async function preparePrompt(text, templateLoaderPath, projectRoot) {
    const templated = await applyTemplate(text, {
        messageTemplateLoaderPath: templateLoaderPath,
        data: {},
        cwd: projectRoot
    }, null);

    let lorebookPath = resolveLorebookPath(templated, templateLoaderPath);
    if (!lorebookPath) {
        const defaultPath = path.resolve(templateLoaderPath, 'character_book.json');
        if (fs.existsSync(defaultPath)) lorebookPath = defaultPath;
    }
    let withLorebook = templated;
    if (lorebookPath) {
        const lorebook = JSON.parse(fs.readFileSync(lorebookPath, 'utf8'));
        withLorebook = applyLorebook(templated, lorebook);
    }

    return rpToPrompt(withLorebook, projectRoot);
}

module.exports = { getDocumentText, preparePrompt };
