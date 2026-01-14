const fs = require('fs');
const process = require('process');
const nunjucks = require('nunjucks');
const pqutils = require('./pqutils.js');
const yaml = require('js-yaml');

async function applyTemplate(promptText, options) {
    const { config, messages } = pqutils.parseConfigAndMessages(promptText);
    const resolvedConfig = pqutils.resolveConfig(config, process.cwd());

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

    const env = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(options.messageTemplateLoaderPath)
    );

    let renderedMessages = [];
    for (let message of messages) {
        const content = env.renderString(message.content, fullMessageTemplateContext);
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
