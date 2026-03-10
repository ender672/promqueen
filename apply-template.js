const process = require('process');
const path = require('path');
const { renderTemplate, buildTemplateContext } = require('./lib/render-template.js');

function canInclude(index, messages) {
    const role = messages[index].role;
    if (role === null) return true;
    if (index === 0) return true;
    if (index === 1) {
        const r0 = messages[0].role;
        return (r0 === 'system' && (role === 'user' || role === 'assistant'))
            || (r0 === 'user' && role === 'assistant');
    }
    if (index === 2) {
        return messages[0].role === 'system'
            && messages[1].role === 'user'
            && role === 'assistant';
    }
    return false;
}

function applyTemplate(messages, resolvedConfig, options = {}) {
    const cwd = options.cwd || process.cwd();
    const templateLoaderPath = resolvedConfig.message_template_loader_path || options.messageTemplateLoaderPath || cwd;

    const fullMessageTemplateContext = {
        ...buildTemplateContext(resolvedConfig, messages, { cwd }),
    };

    return messages.map((message, i) => {
        if (message.content === null) {
            return { ...message };
        }

        const allowIncludes = canInclude(i, messages);
        // We pass a dummy file name 'root' joined to the loader path so that
        // renderTemplate's path.dirname() correctly resolves to templateLoaderPath
        const content = renderTemplate(
            message.content,
            fullMessageTemplateContext,
            path.join(templateLoaderPath, 'root'),
            templateLoaderPath,
            { allowIncludes }
        );
        return { ...message, content };
    });
}

module.exports = { applyTemplate };
