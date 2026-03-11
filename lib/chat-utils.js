const pqutils = require('./pq-utils.js');

/**
 * Build the display screen from completed messages in a document.
 * Skips the last message if it has no content (it's a pending marker).
 */
function displayConversation(content, doc) {
    const lastMsg = doc.messages.at(-1);
    const displayCount = (lastMsg && !lastMsg.content)
        ? doc.messages.length - 1
        : doc.messages.length;

    let screen = '';
    for (let i = 0; i < displayCount; i++) {
        const msg = doc.messages[i];
        if (i > 0) screen += '\n';
        if (msg.name) screen += `@${msg.name}\n`;
        if (msg.content) {
            screen += msg.content;
            if (!msg.content.endsWith('\n')) screen += '\n';
        }
    }
    return screen;
}

/**
 * Find the byte offset in content where display should start
 * (i.e. skip past content already shown, stopping before a trailing empty marker).
 */
function computeInitialDisplayPos(content) {
    const doc = pqutils.parseConfigAndMessages(content);
    const lastMsg = doc.messages.at(-1);
    if (lastMsg && !lastMsg.content) {
        const marker = `@${lastMsg.name}`;
        for (let pos = content.length; pos > 0;) {
            pos = content.lastIndexOf(marker, pos - 1);
            if (pos < 0) break;
            if (pos === 0 || content[pos - 1] === '\n') {
                return (pos > 0) ? pos - 1 : pos;
            }
        }
    }
    return content.length;
}

/**
 * Ensure the file ends with an empty @userName marker ready for user input.
 */
function ensureReadyForUserInput(store, userName) {
    const content = store.read();
    const doc = pqutils.parseConfigAndMessages(content);
    const lastMsg = doc.messages.at(-1);
    if (lastMsg && lastMsg.name === userName && (lastMsg.content === null || lastMsg.content === '')) return;

    let padding;
    if (content.endsWith('\n\n')) padding = '';
    else if (content.endsWith('\n')) padding = '\n';
    else padding = '\n\n';
    store.append(padding + `@${userName}\n`);
}

module.exports = { displayConversation, computeInitialDisplayPos, ensureReadyForUserInput };
