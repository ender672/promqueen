#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Parser, Context } = require('@ender672/minja-js/minja');
const { extractAiCardData } = require('./lib/card-utils');
const { loadDotConfig } = require('./lib/pq-utils');

const BUILTIN_TEMPLATES = {
    'char-sheet': 'charcard-char-sheet.jinja',
    'prompt': 'charcard-prompt.jinja',
};
const defaultTemplatePath = path.join(__dirname, 'templates', BUILTIN_TEMPLATES['char-sheet']);

function buildTemplateView(characterData, { altGreeting } = {}) {
    const name = (characterData.name || 'Character').trim();

    const parts = [];
    if (characterData.description) parts.push(characterData.description);
    if (characterData.personality) parts.push(characterData.personality);
    if (characterData.scenario) parts.push(`Scenario: ${characterData.scenario}`);

    const examples = [];
    if (characterData.mes_example) {
        const parsed = characterData.mes_example
            .split('<START>')
            .map(x => x.trim())
            .filter(x => x.length > 0);
        examples.push(...parsed);
    }

    let openingMessage = characterData.first_mes || '';
    if (altGreeting != null) {
        const alts = characterData.alternate_greetings || [];
        if (altGreeting < 0 || altGreeting >= alts.length) {
            throw new Error(`Alternate greeting ${altGreeting} out of range (${alts.length} available)`);
        }
        openingMessage = alts[altGreeting];
    }

    return {
        name,
        parts: parts.map(p => p.replaceAll('{{char}}', name)),
        examples: examples.map(e => e.replaceAll('{{char}}', name)),
        opening_message: openingMessage.replaceAll('{{char}}', name),
    };
}

function createChatmlPrompt(characterData, templateText, { altGreeting, roleplayUser } = {}) {
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
    const result = createChatmlPrompt(aiCardData, templateText, { altGreeting: opts.altGreeting, roleplayUser });
    process.stdout.write(result + "\n");
}

if (require.main === module) {
  main();
}

module.exports = { createChatmlPrompt, buildTemplateView };
