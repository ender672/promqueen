#!/usr/bin/env node

const { extractAiCardData } = require('./lib/cardutils');

function cardToJson(cardData) {
    return JSON.stringify(cardData, null, 2);
}

function main() {
    const args = process.argv.slice(2);

    if (args.length < 1) {
        console.error("Usage: node charcard-png-to-json.js <path_to_png>");
        console.error("Example: node charcard-png-to-json.js card.png");
        process.exit(1);
    }

    const cardFile = args[0];
    const aiCardData = extractAiCardData(cardFile);
    console.log(cardToJson(aiCardData));
}

if (require.main === module) {
    main();
}

module.exports = { cardToJson };
