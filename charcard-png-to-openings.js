#!/usr/bin/env node

const fs = require('fs');
const { extractAiCardData } = require('./lib/cardutils');

/**
 * Sanitizes a character name to be safe for use as a filename.
 * Whitelist: a-z, A-Z, 0-9, _, -
 */
function filenameSafeCharname(name) {
    // Replace spaces with underscores
    let sanitized = name.replace(/ /g, '_');

    // Remove characters not in the whitelist (Alphanumeric + _ + -)
    sanitized = sanitized.replace(/[^a-zA-Z0-9_-]/g, '');

    if (!sanitized || sanitized.length > 200) {
        return "unnamed";
    }
    return sanitized;
}

/**
 * Replace {{char}} placeholders with the character name.
 */
function formatMessage(charName, message) {
    return message.replaceAll('{{char}}', charName);
}

/**
 * Extracts first message and alternate greetings as an array of
 * { filename, content } objects — no filesystem I/O.
 */
function exportCharacterMessages(characterData) {
    const name = (characterData.name || 'Character').trim();
    const safeName = filenameSafeCharname(name);
    const results = [];

    // 1. Handle First Message
    const firstMes = characterData.first_mes;
    if (firstMes) {
        results.push({
            filename: `${safeName}-first-message.txt`,
            content: formatMessage(name, firstMes),
        });
    }

    // 2. Handle Alternate Greetings
    const alternateGreetings = characterData.alternate_greetings || [];
    alternateGreetings.forEach((greeting, index) => {
        results.push({
            filename: `${safeName}-alternate-greeting-${index + 1}.txt`,
            content: formatMessage(name, greeting),
        });
    });

    return results;
}

function main() {
    const args = process.argv.slice(2);

    if (args.length < 1) {
        console.error("Usage: node charcard-png-to-openings.js <path_to_png>");
        process.exit(1);
    }

    const cardFile = args[0];

    try {
        const aiCardData = extractAiCardData(cardFile);
        const messages = exportCharacterMessages(aiCardData);
        for (const { filename, content } of messages) {
            fs.writeFileSync(filename, content, 'utf8');
            console.log(`Created: ${filename}`);
        }
    } catch (error) {
        console.error("Error:", error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { filenameSafeCharname, formatMessage, exportCharacterMessages };
