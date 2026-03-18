const process = require('process');
const fs = require('fs');
const path = require('path');
const pqutils = require('./pq-utils.js');
const { extractAiCardData } = require('./card-utils.js');
const { buildTemplateView } = require('../charcard-png-to-txt.js');

function getValue(obj, pathString) {
    return pathString.split('.').reduce((acc, part) => {
        return acc && acc[part] !== undefined ? acc[part] : undefined;
    }, obj);
}

function splitCBSArgs(argsStr) {
    const parts = [];
    let current = '';
    for (let i = 0; i < argsStr.length; i++) {
        if (argsStr[i] === '\\' && i + 1 < argsStr.length && argsStr[i + 1] === ',') {
            current += ',';
            i++;
        } else if (argsStr[i] === ',') {
            parts.push(current);
            current = '';
        } else {
            current += argsStr[i];
        }
    }
    parts.push(current);
    return parts.map(p => p.trim());
}

function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

function formatIdleDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return seconds === 1 ? '1 second' : `${seconds} seconds`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes === 1 ? '1 minute' : `${minutes} minutes`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours === 1 ? '1 hour' : `${hours} hours`;
    const days = Math.floor(hours / 24);
    if (days < 7) return days === 1 ? '1 day' : `${days} days`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return weeks === 1 ? '1 week' : `${weeks} weeks`;
    const months = Math.floor(days / 30);
    if (months < 12) return months === 1 ? '1 month' : `${months} months`;
    const years = Math.floor(days / 365);
    return years === 1 ? '1 year' : `${years} years`;
}

function expandCBS(text, templateContext, promptText) {
    return text.replace(/\{\{(.*?)\}\}/g, (match, inner) => {
        const trimmed = inner.trim();
        const lower = trimmed.toLowerCase();

        if (lower === 'char') {
            const name = templateContext.char;
            return name !== undefined && name !== '' ? name : match;
        }

        if (lower === 'user') {
            const userName = templateContext.user;
            return userName !== undefined && userName !== '' ? userName : match;
        }

        if (lower === 'date') {
            return new Date().toLocaleDateString();
        }

        if (lower === 'time') {
            return new Date().toLocaleTimeString();
        }

        if (lower.startsWith('//')) {
            return '';
        }

        if (lower.startsWith('random:')) {
            const argsStr = trimmed.slice('random:'.length);
            const options = splitCBSArgs(argsStr);
            return options[Math.floor(Math.random() * options.length)];
        }

        if (lower.startsWith('pick:')) {
            const argsStr = trimmed.slice('pick:'.length);
            const options = splitCBSArgs(argsStr);
            const hash = simpleHash(promptText || '');
            return options[hash % options.length];
        }

        if (lower.startsWith('roll:')) {
            const arg = trimmed.slice('roll:'.length).trim();
            const numStr = arg.replace(/^d/i, '');
            const n = parseInt(numStr, 10);
            if (isNaN(n) || n < 1) return match;
            return String(Math.floor(Math.random() * n) + 1);
        }

        if (lower.startsWith('reverse:')) {
            const arg = trimmed.slice('reverse:'.length);
            return arg.split('').reverse().join('');
        }

        // Dot-notation variable lookup fallback; leave unrecognized macros intact
        const value = getValue(templateContext, trimmed);
        if (value !== undefined) return String(value);

        return match;
    });
}

function buildTemplateContext(resolvedConfig, messages, options = {}) {
    const context = {
        original: '',
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

    if (options.promptFilePath && context.idle_duration === undefined) {
        try {
            const stat = fs.statSync(options.promptFilePath);
            context.idle_duration = formatIdleDuration(Date.now() - stat.mtimeMs);
        } catch { /* file not found or inaccessible */ }
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

module.exports = { expandCBS, buildTemplateContext };
