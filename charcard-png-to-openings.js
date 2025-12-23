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
    sanitized = sanitized.replace(/[^a-zA-Z0-9_\-]/g, '');

    if (!sanitized || sanitized.length > 200) {
        return "unnamed";
    }
    return sanitized;
}

/**
 * Helper to replace placeholders and write to disk.
 */
function writeMessage(filePath, charName, message) {
    // Node.js 'replaceAll' requires v15+
    const content = message.replaceAll('{{char}}', charName);
    fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Extracts first message and alternate greetings to text files.
 */
function exportCharacterMessages(characterData) {
    const name = (characterData.name || 'Character').trim();
    const safeName = filenameSafeCharname(name);

    // 1. Handle First Message
    const firstMes = characterData.first_mes;
    if (firstMes) {
        const filename = `${safeName}-first-message.txt`;
        writeMessage(filename, name, firstMes);
        console.log(`Created: ${filename}`);
    }

    // 2. Handle Alternate Greetings
    const alternateGreetings = characterData.alternate_greetings || [];
    
    // Using forEach to handle the index (enumerate equivalent)
    alternateGreetings.forEach((greeting, index) => {
        const filename = `${safeName}-alternate-greeting-${index + 1}.txt`;
        writeMessage(filename, name, greeting);
        console.log(`Created: ${filename}`);
    });
}

// Main execution block
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length < 1) {
        console.error("Usage: node extract_messages.js <path_to_png>");
        process.exit(1);
    }

    const cardFile = args[0];

    try {
        const aiCardData = extractAiCardData(cardFile);
        exportCharacterMessages(aiCardData);
    } catch (error) {
        console.error("Error:", error.message);
        process.exit(1);
    }
}
