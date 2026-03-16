const process = require('process');
const fs = require('fs');
const path = require('path');
const pqutils = require('./pq-utils.js');
const { extractAiCardData } = require('./card-utils.js');
const { buildTemplateView } = require('../charcard-png-to-txt.js');

function getValue(obj, pathString) {
    return pathString.split('.').reduce((acc, part) => {
        return acc && acc[part] !== undefined ? acc[part] : '';
    }, obj);
}

/**
 * Render template: variable substitution only. {% include %} is not supported
 * — charcard data is untrusted and could inject include directives to read
 * arbitrary files from disk.
 */
function renderTemplate(templateContent, context) {
    const variableRegex = /{{\s*([\w.]+)\s*}}/g;
    return templateContent.replace(variableRegex, (match, variableName) => {
        return getValue(context, variableName);
    });
}

function buildTemplateContext(resolvedConfig, messages, options = {}) {
    const context = {
        ...resolvedConfig.message_template_variables,
    };

    if (context.user === undefined && resolvedConfig.roleplay_user) {
        context.user = resolvedConfig.roleplay_user;
    }

    if (context.char === undefined) {
        const skipNames = [...pqutils.PROMPT_ROLES, context.user];
        const firstCharMsg = messages.find(m => !skipNames.includes(m.name));

        if (firstCharMsg) {
            context.char = firstCharMsg.name;
        }
    }

    if (resolvedConfig.charcard && !context.charcard) {
        const cwd = options.cwd || process.cwd();
        const charcardPath = path.resolve(cwd, resolvedConfig.charcard);
        if (fs.existsSync(charcardPath)) {
            const aiCardData = extractAiCardData(charcardPath);
            const view = buildTemplateView(aiCardData);
            context.charcard = view.charcard;
        }
    }

    return context;
}

module.exports = { renderTemplate, buildTemplateContext };
