#!/usr/bin/env node

const { extractAiCardData } = require('./lib/cardutils');

function getCardField(cardData, fieldName) {
    if (fieldName in cardData) {
        const value = cardData[fieldName];
        if (typeof value === 'object') {
            return JSON.stringify(value, null, 2);
        }
        return String(value);
    }
    const available = Object.keys(cardData).join(', ');
    throw new Error(`Field '${fieldName}' not found in card data. Available fields: ${available}`);
}

function main() {
    const args = process.argv.slice(2);

    if (args.length < 2) {
        console.error("Usage: node get_name.js <path_to_png> <field_name>");
        console.error("Example: node get_name.js card.png description");
        process.exit(1);
    }

    const cardFile = args[0];
    const targetField = args[1];

    try {
        const aiCardData = extractAiCardData(cardFile);
        console.log(getCardField(aiCardData, targetField));
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { getCardField };
