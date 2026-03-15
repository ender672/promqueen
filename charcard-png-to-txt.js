#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Parser, Context } = require('@ender672/minja-js/minja');
const { extractAiCardData } = require('./lib/card-utils');
const { loadDotConfig } = require('./lib/pq-utils');
const { discoverTemplates } = require('./lib/template-registry');

const defaultTemplatePath = path.join(__dirname, 'templates', 'charcard-char-sheet.jinja');

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

function renderCharcardTemplate(characterData, templateText, { altGreeting, roleplayUser, roleplayUserDescription, roleplayGuidelines } = {}) {
    if (!templateText) {
        templateText = fs.readFileSync(defaultTemplatePath, 'utf8');
    }
    const view = buildTemplateView(characterData, { altGreeting });
    if (roleplayUser) view.user = roleplayUser;
    if (roleplayUserDescription) view.user_description = roleplayUserDescription;
    if (roleplayGuidelines) view.roleplay_guidelines = roleplayGuidelines;
    const root = Parser.parse(templateText);
    const ctx = Context.make(view);
    return root.render(ctx).trimEnd();
}

function main() {
    const { Command } = require('commander');
    const program = new Command();

    const templates = discoverTemplates();
    const templateIds = templates.map(t => t.id);

    program
        .argument('<png_path>', 'path to character card PNG')
        .argument('[template_path]', 'path to a custom jinja template')
        .option('--template <name>', `use a template by ID (${templateIds.join(', ')})`)
        .option('--alt-greeting <n>', 'use alternate greeting by index', parseInt)
        .parse();

    const opts = program.opts();
    const [pngPath, customTemplatePath] = program.args;

    let templatePath;
    if (opts.template) {
        const match = templates.find(t => t.id === opts.template);
        if (!match) {
            console.error(`Error: unknown template '${opts.template}'. Available: ${templateIds.join(', ')}`);
            process.exit(1);
        }
        templatePath = match.filePath;
    } else {
        templatePath = customTemplatePath || defaultTemplatePath;
    }

    const templateText = fs.readFileSync(templatePath, 'utf8');
    const dotConfig = loadDotConfig();
    const roleplayUser = dotConfig.roleplay_user;
    const roleplayUserDescription = dotConfig.roleplay_user_description;
    const roleplayGuidelines = dotConfig.roleplay_guidelines;
    const aiCardData = extractAiCardData(pngPath);
    const result = renderCharcardTemplate(aiCardData, templateText, { altGreeting: opts.altGreeting, roleplayUser, roleplayUserDescription, roleplayGuidelines });
    process.stdout.write(result + "\n");
}

if (require.main === module) {
  main();
}

module.exports = { renderCharcardTemplate, buildTemplateView };
