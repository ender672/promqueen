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
 * Render Template with Jinja2-like Exception Handling
 */
function renderTemplate(templateContent, context, currentPath, rootDir, options) {
    // 1. Setup Defaults
    if (!currentPath) {
        currentPath = path.join(process.cwd(), 'template.html');
    }

    const absoluteCurrentPath = path.resolve(currentPath);
    const currentDir = path.dirname(absoluteCurrentPath);

    if (!rootDir) {
        rootDir = currentDir;
    }
    const absoluteRoot = path.resolve(rootDir);

    const allowIncludes = !options || options.allowIncludes !== false;

    // 2. Process Includes
    const includeRegex = /{%\s*include\s+(.+?)\s*%}/g;

    let renderedContent = allowIncludes ? templateContent.replace(includeRegex, (match, rawArg) => {
        const token = rawArg.trim();
        let fileName;

        // Support for string concatenation with ~
        const parts = token.split('~').map(part => part.trim());

        fileName = parts.map(part => {
            if ((part.startsWith('"') && part.endsWith('"')) ||
                (part.startsWith("'") && part.endsWith("'"))) {
                return part.slice(1, -1);
            } else {
                return getValue(context, part);
            }
        }).join('');

        if (!fileName) {
            throw new Error(`Template Error: Include path variable "${token}" is empty or undefined.`);
        }

        // Resolve path
        const includePath = path.resolve(currentDir, fileName);

        // 3. SECURITY CHECK: Throw specific error for tests
        if (!includePath.startsWith(absoluteRoot)) {
            // Jinja2 behavior: Stop processing immediately
            // Using "Illegal template path" to satisfy your test's regex/expectations
            throw new Error(`illegal template path: ${fileName}`);
        }

        // 4. File Reading: Throw "Template not found" on failure
        let includeContent;
        try {
            includeContent = fs.readFileSync(includePath, 'utf-8');
        } catch (err) {
            if (err.code === 'ENOENT') {
                throw new Error(`Template not found: ${fileName}`);
            }
            throw err; // Re-throw other errors (permissions, etc.)
        }

        // Recursive call (Let exceptions bubble up)
        return renderTemplate(includeContent, context, includePath, absoluteRoot, options);
    }) : templateContent;

    // 5. Process Variables
    const variableRegex = /{{\s*([\w.]+)\s*}}/g;
    renderedContent = renderedContent.replace(variableRegex, (match, variableName) => {
        return getValue(context, variableName);
    });

    return renderedContent;
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
