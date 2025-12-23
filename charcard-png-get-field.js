#!/usr/bin/env node

const { extractAiCardData } = require('./lib/cardutils');

if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length < 2) {
        console.error("Usage: node get_name.js <path_to_png> <field_name>");
        console.error("Example: node get_name.js card.png description");
        process.exit(1);
    }

    const cardFile = args[0];
    const targetField = args[1];

    const aiCardData = extractAiCardData(cardFile);

    if (targetField in aiCardData) {
        const value = aiCardData[targetField];
        
        if (typeof value === 'object') {
            console.log(JSON.stringify(value, null, 2));
        } else {
            console.log(value);
        }
    } else {
        console.error(`Error: Field '${targetField}' not found in card data.`);
        console.error("Available fields:", Object.keys(aiCardData).join(', '));
        process.exit(1);
    }
}
