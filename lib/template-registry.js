const fs = require('fs');
const path = require('path');
const os = require('os');

const USER_TEMPLATES_DIR = path.join(os.homedir(), '.promqueen-templates');

function parseTemplateMetadata(text) {
    const match = text.match(/^\{#\s*---\s*\n([\s\S]*?)\n\s*---\s*#\}/);
    if (!match) return null;
    const block = match[1];
    const result = {};
    for (const line of block.split('\n')) {
        const m = line.match(/^\s*(name|description)\s*:\s*(.+)/);
        if (m) result[m[1]] = m[2].trim();
    }
    return (result.name || result.description) ? result : null;
}

function discoverTemplates() {
    const templates = [];
    if (!fs.existsSync(USER_TEMPLATES_DIR)) return templates;

    for (const file of fs.readdirSync(USER_TEMPLATES_DIR)) {
        if (!file.endsWith('.pqueen.jinja')) continue;
        const filePath = path.join(USER_TEMPLATES_DIR, file);
        const id = path.basename(file, '.pqueen.jinja');
        const text = fs.readFileSync(filePath, 'utf8');
        const meta = parseTemplateMetadata(text) || {};
        templates.push({
            id,
            name: meta.name || id,
            description: meta.description || '',
            filePath,
        });
    }

    return templates;
}

function resolveTemplatePath(identifier) {
    if (!identifier) return null;

    // Absolute or relative path
    if (path.isAbsolute(identifier) || identifier.includes(path.sep) || identifier.includes('/')) {
        return path.resolve(identifier);
    }

    // Try as template ID
    const templates = discoverTemplates();
    const match = templates.find(t => t.id === identifier);
    if (match) return match.filePath;

    // Try as filename
    const byFilename = templates.find(t => path.basename(t.filePath) === identifier);
    if (byFilename) return byFilename.filePath;

    return path.resolve(identifier);
}

module.exports = { parseTemplateMetadata, discoverTemplates, resolveTemplatePath, USER_TEMPLATES_DIR };
