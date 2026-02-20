#!/usr/bin/env node

const { extractAiCardData } = require('./lib/cardutils');

function createChatmlPrompt(characterData) {
    const name = (characterData.name || 'Character').trim();
    const description = characterData.description;
    const personality = characterData.personality;
    const scenario = characterData.scenario;

    const systemParts = [];

    if (description) systemParts.push(description);
    if (personality) systemParts.push(personality);
    if (scenario) systemParts.push(`Scenario: ${scenario}`);

    let roleplayPrompt = systemParts.join('\n');

    const mesExample = characterData.mes_example;
    if (mesExample) {
        const mesExampleAry = mesExample
            .split('<START>')
            .map(x => x.trim())
            .filter(x => x.length > 0);

        if (mesExampleAry.length > 0) {
            roleplayPrompt += "\n\nEXAMPLE MESSAGES:";
            for (const x of mesExampleAry) {
                roleplayPrompt += `\n\n${name}: ${x}`;
            }
        }
    }

    roleplayPrompt = roleplayPrompt.replaceAll('{{char}}', name);
    return roleplayPrompt;
}

function main() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error("Usage: node card_reader.js <path_to_png>");
        process.exit(1);
    }

    const aiCardData = extractAiCardData(args[0]);
    const chatml = createChatmlPrompt(aiCardData);
    process.stdout.write(chatml + "\n");
}

if (require.main === module) {
  main();
}

module.exports = { createChatmlPrompt };
