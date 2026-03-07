#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Parser, Context } = require('@ender672/minja-js/minja');
const { extractAiCardData } = require('./lib/card-utils');
const { loadDotConfig } = require('./lib/pq-utils');

const BUILTIN_TEMPLATES = {
    'char-sheet': 'charcard-char-sheet.jinja',
    'prompt-includes': 'charcard-prompt-includes.jinja',
    'prompt-complete': 'charcard-prompt-charcard-complete.jinja',
};
const defaultTemplatePath = path.join(__dirname, 'templates', BUILTIN_TEMPLATES['char-sheet']);

function buildTemplateView(characterData, { altGreeting } = {}) {
    const charcard = { ...characterData };
    if (!charcard.name) charcard.name = 'Character';
    charcard.name = charcard.name.trim();

    if (charcard.mes_example) {
        charcard.mes_example = charcard.mes_example
            .split('<START>')
            .map(x => x.trim())
            .filter(x => x.length > 0);
    } else {
        charcard.mes_example = [];
    }

    if (altGreeting != null) {
        const alts = charcard.alternate_greetings || [];
        if (altGreeting < 0 || altGreeting >= alts.length) {
            throw new Error(`Alternate greeting ${altGreeting} out of range (${alts.length} available)`);
        }
        charcard.first_mes = alts[altGreeting];
    }

    // Replace {{char}} with the character name in all string fields
    for (const [key, value] of Object.entries(charcard)) {
        if (typeof value === 'string') {
            charcard[key] = value.replaceAll('{{char}}', charcard.name);
        } else if (Array.isArray(value)) {
            charcard[key] = value.map(v => typeof v === 'string' ? v.replaceAll('{{char}}', charcard.name) : v);
        }
    }

    return { charcard };
}

function renderCharcardTemplate(characterData, templateText, { altGreeting, roleplayUser } = {}) {
    if (!templateText) {
        templateText = fs.readFileSync(defaultTemplatePath, 'utf8');
    }
    const view = buildTemplateView(characterData, { altGreeting });
    if (roleplayUser) view.user = roleplayUser;
    const root = Parser.parse(templateText);
    const ctx = Context.make(view);
    return root.render(ctx).trimEnd();
}

function main() {
    const { Command } = require('commander');
    const program = new Command();

    program
        .argument('<png_path>', 'path to character card PNG')
        .argument('[template_path]', 'path to a custom jinja template')
        .option('--builtin <name>', `use a built-in template (${Object.keys(BUILTIN_TEMPLATES).join(', ')})`)
        .option('--alt-greeting <n>', 'use alternate greeting by index', parseInt)
        .parse();

    const opts = program.opts();
    const [pngPath, customTemplatePath] = program.args;

    let templatePath;
    if (opts.builtin) {
        if (!BUILTIN_TEMPLATES[opts.builtin]) {
            console.error(`Error: unknown builtin template '${opts.builtin}'. Available: ${Object.keys(BUILTIN_TEMPLATES).join(', ')}`);
            process.exit(1);
        }
        templatePath = path.join(__dirname, 'templates', BUILTIN_TEMPLATES[opts.builtin]);
    } else {
        templatePath = customTemplatePath || defaultTemplatePath;
    }

    const templateText = fs.readFileSync(templatePath, 'utf8');
    const dotConfig = loadDotConfig();
    const roleplayUser = dotConfig.roleplay_user;
    const aiCardData = extractAiCardData(pngPath);
    const result = renderCharcardTemplate(aiCardData, templateText, { altGreeting: opts.altGreeting, roleplayUser });
    process.stdout.write(result + "\n");
}

if (require.main === module) {
  main();
}

module.exports = { renderCharcardTemplate, buildTemplateView };
