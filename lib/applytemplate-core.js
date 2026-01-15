const process = require('process');
const pqutils = require('./pqutils.js');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

const { renderTemplate } = require('./rendertemplate.js');

async function applyTemplate(promptText, options) {
    const { config, messages } = pqutils.parseConfigAndMessages(promptText);
    const resolvedConfig = pqutils.resolveConfig(config, process.cwd());
    const templateLoaderPath = resolvedConfig.message_template_loader_path || options.messageTemplateLoaderPath || process.cwd();

    const fullMessageTemplateContext = {
        ...options.data,
        ...resolvedConfig.message_template_variables,
    };

    if (fullMessageTemplateContext.user === undefined && resolvedConfig.roleplay_user) {
        fullMessageTemplateContext.user = resolvedConfig.roleplay_user;
    }

    if (fullMessageTemplateContext.char === undefined) {
        const skipNames = [...pqutils.PROMPT_ROLES, fullMessageTemplateContext.user];
        const firstCharMsg = messages.find(m => !skipNames.includes(m.name));

        if (firstCharMsg) {
            fullMessageTemplateContext.char = firstCharMsg.name;
        }
    }

    let renderedMessages = [];
    for (let message of messages) {
        // We pass a dummy file name 'root' joined to the loader path so that
        // renderTemplate's path.dirname() correctly resolves to templateLoaderPath
        const content = renderTemplate(
            message.content,
            fullMessageTemplateContext,
            path.join(templateLoaderPath, 'root'),
            templateLoaderPath
        );
        const namePart = message.name ? `@${message.name}\n` : '';
        renderedMessages.push(`${namePart}${content}`);
    }

    let output = '---\n';
    output += yaml.dump(config);
    output += '---\n';
    output += renderedMessages.join('\n\n');

    return output;
}

module.exports = { applyTemplate };
