const { preparePrompt } = require('../../lib/pipeline.js');

function getDocumentText(document) {
    return document.getText().replace(/\r\n/g, '\n');
}

module.exports = { getDocumentText, preparePrompt };
