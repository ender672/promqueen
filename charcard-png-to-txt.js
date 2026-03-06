#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Parser, Context } = require('@ender672/minja-js/minja');
const { extractAiCardData } = require('./lib/card-utils');
const { loadDotConfig } = require('./lib/pq-utils');

const defaultTemplatePath = path.join(__dirname, 'templates', 'charcard-char-sheet.jinja');

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
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error("Usage: charcard-png-to-txt <path_to_png> [template_path] [--alt-greeting <n>]");
        process.exit(1);
    }

    let altGreeting;
    const altIdx = args.indexOf('--alt-greeting');
    if (altIdx !== -1) {
        altGreeting = parseInt(args[altIdx + 1], 10);
        if (Number.isNaN(altGreeting)) {
            console.error("Error: --alt-greeting requires a numeric argument");
            process.exit(1);
        }
        args.splice(altIdx, 2);
    }

    const templatePath = args[1] || defaultTemplatePath;
    const templateText = fs.readFileSync(templatePath, 'utf8');
    const dotConfig = loadDotConfig();
    const roleplayUser = dotConfig.roleplay_user;
    const aiCardData = extractAiCardData(args[0]);
    const result = createChatmlPrompt(aiCardData, templateText, { altGreeting, roleplayUser });
    process.stdout.write(result + "\n");
}

if (require.main === module) {
  main();
}

module.exports = { createChatmlPrompt, buildTemplateView };
