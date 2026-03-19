// Filters HTML comments (<!-- ... -->) from streamed text for display.
// Comments are stripped; lines that become empty purely from comment removal
// are dropped to avoid extra blank lines.

function filterLine(line, inComment) {
    let result = '';
    let ic = inComment;
    let i = 0;
    while (i < line.length) {
        if (ic) {
            const close = line.indexOf('-->', i);
            if (close === -1) return { text: result, inComment: true };
            ic = false;
            i = close + 3;
        } else {
            const open = line.indexOf('<!--', i);
            if (open === -1) { result += line.slice(i); break; }
            result += line.slice(i, open);
            ic = true;
            i = open + 4;
        }
    }
    return { text: result, inComment: ic };
}

// Takes raw streamed content (complete string) and returns display lines
// with HTML comments stripped and comment-only lines removed.
function filterStreamContent(raw) {
    const rawLines = raw.split('\n');
    const displayLines = [];
    let inComment = false;
    for (const line of rawLines) {
        const result = filterLine(line, inComment);
        inComment = result.inComment;
        // Skip lines that become empty purely from comment removal
        if (result.text === '' && line.trim() !== '') continue;
        displayLines.push(result.text);
    }
    return displayLines.join('\n');
}

module.exports = { filterLine, filterStreamContent };
