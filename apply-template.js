const process = require('process');
const { expandCBS, buildTemplateContext } = require('./lib/render-template.js');

function applyTemplate(messages, resolvedConfig, options = {}) {
    const cwd = options.cwd || process.cwd();

    const fullMessageTemplateContext = {
        ...buildTemplateContext(resolvedConfig, messages, { cwd }),
    };

    return messages.map((message) => {
        if (message.content === null) {
            return { ...message };
        }

        const content = expandCBS(message.content, fullMessageTemplateContext);
        return { ...message, content };
    });
}

module.exports = { applyTemplate };
