#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Parser, Context } = require('@ender672/minja-js/minja');
const { extractAiCardData } = require('./lib/card-utils');

const defaultTemplatePath = path.join(__dirname, 'templates', 'charcard-to-txt.jinja');

function buildTemplateView(characterData) {
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

    return {
        name,
        parts: parts.map(p => p.replaceAll('{{char}}', name)),
        examples: examples.map(e => e.replaceAll('{{char}}', name)),
    };
}

function createChatmlPrompt(characterData, templateText) {
    if (!templateText) {
        templateText = fs.readFileSync(defaultTemplatePath, 'utf8');
    }
    const view = buildTemplateView(characterData);
    const root = Parser.parse(templateText);
    const ctx = Context.make(view);
    return root.render(ctx).trimEnd();
}

function main() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error("Usage: charcard-png-to-txt <path_to_png> [template_path]");
        process.exit(1);
    }

    const templatePath = args[1] || defaultTemplatePath;
    const templateText = fs.readFileSync(templatePath, 'utf8');
    const aiCardData = extractAiCardData(args[0]);
    const result = createChatmlPrompt(aiCardData, templateText);
    process.stdout.write(result + "\n");
}

if (require.main === module) {
  main();
}

module.exports = { createChatmlPrompt, buildTemplateView };
