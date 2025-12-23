#!/usr/bin/env node

const { extractAiCardData } = require('./lib/cardutils');

if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length < 1) {
        console.error("Usage: node get_name.js <path_to_png>");
        console.error("Example: node get_name.js card.png");
        process.exit(1);
    }

    const cardFile = args[0];
    const aiCardData = extractAiCardData(cardFile);
    console.log(JSON.stringify(aiCardData, null, 2));
}
