const readline = require('readline');

function promptTextInput(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
        rl.question(question, (answer) => {
            rl.close();
            process.stderr.write('\x1b[1A\x1b[2K');
            resolve(answer.trim());
        });
    });
}

function promptSelection(items, header, { previews, disabled } = {}) {
    let selected = 0;
    const cols = process.stderr.columns || 80;
    const rows = process.stderr.rows || 24;
    const maxPreviewLines = 12;

    function wrapText(text, width) {
        const lines = [];
        for (const rawLine of text.split('\n')) {
            if (rawLine.length <= width) {
                lines.push(rawLine);
            } else {
                for (let i = 0; i < rawLine.length; i += width) {
                    lines.push(rawLine.slice(i, i + width));
                }
            }
        }
        return lines;
    }

    function getPreviewLines() {
        if (!previews) return [];
        const wrapped = wrapText(previews[selected], cols - 2);
        const truncated = wrapped.slice(0, maxPreviewLines);
        if (wrapped.length > maxPreviewLines) truncated.push('...');
        return truncated;
    }

    // Reserve space for header and preview, cap visible items to fit terminal
    const previewHeight = previews ? 1 + maxPreviewLines : 0;
    const overhead = 3 + previewHeight; // header newline + header + blank line + preview
    const maxVisibleItems = Math.max(3, rows - overhead);
    const visibleItems = Math.min(items.length, maxVisibleItems);
    const needsScroll = items.length > visibleItems;
    let scrollOffset = 0;

    const totalLines = visibleItems + previewHeight;

    const draw = () => {
        // Move cursor up to redraw
        process.stderr.write(`\x1b[${totalLines}A`);

        // Keep selected item in view
        if (selected < scrollOffset) {
            scrollOffset = selected;
        } else if (selected >= scrollOffset + visibleItems) {
            scrollOffset = selected - visibleItems + 1;
        }

        for (let vi = 0; vi < visibleItems; vi++) {
            const i = scrollOffset + vi;
            const isDisabled = disabled && disabled[i];
            const isCurrent = i === selected;
            let label = items[i];

            // Scroll indicators on first/last visible line
            if (needsScroll && vi === 0 && scrollOffset > 0) {
                label += '  \x1b[90m[' + scrollOffset + ' more above]\x1b[0m';
            } else if (needsScroll && vi === visibleItems - 1 && scrollOffset + visibleItems < items.length) {
                label += '  \x1b[90m[' + (items.length - scrollOffset - visibleItems) + ' more below]\x1b[0m';
            }

            let line;
            if (isCurrent) {
                line = isDisabled
                    ? `\x1b[90m> ${label}\x1b[0m`
                    : `\x1b[36m> ${label}\x1b[0m`;
            } else {
                line = isDisabled
                    ? `\x1b[90m  ${label}\x1b[0m`
                    : `  ${label}`;
            }
            process.stderr.write(`\x1b[2K${line}\n`);
        }

        if (previews) {
            const previewLines = getPreviewLines();
            process.stderr.write(`\x1b[2K\x1b[90m${'─'.repeat(Math.min(40, cols))}\x1b[0m\n`);
            for (let i = 0; i < maxPreviewLines; i++) {
                process.stderr.write(`\x1b[2K${i < previewLines.length ? '  ' + previewLines[i] : ''}\n`);
            }
        }
    };

    return new Promise((resolve) => {
        process.stderr.write(`\n${header}\n\n`);
        // Print initial blank lines so draw() can overwrite them
        for (let i = 0; i < totalLines; i++) {
            process.stderr.write('\n');
        }
        draw();

        const wasRaw = process.stdin.isRaw;
        process.stdin.setRawMode(true);
        process.stdin.resume();

        const onData = (key) => {
            // Ctrl+C
            if (key[0] === 0x03) {
                process.stdin.setRawMode(wasRaw);
                process.stdin.removeListener('data', onData);
                process.stderr.write('\n');
                process.exit(0);
            }
            // Enter
            if (key[0] === 0x0d) {
                process.stdin.setRawMode(wasRaw);
                process.stdin.removeListener('data', onData);
                process.stdin.pause();
                // Clear the selection UI (header area + items/preview)
                const clearCount = 3 + totalLines;
                process.stderr.write(`\x1b[${clearCount}A\x1b[J`);
                resolve(selected);
                return;
            }
            // Arrow keys: ESC [ A (up) / ESC [ B (down)
            if (key[0] === 0x1b && key[1] === 0x5b) {
                if (key[2] === 0x41) selected = (selected - 1 + items.length) % items.length; // up
                if (key[2] === 0x42) selected = (selected + 1) % items.length;                // down
                draw();
            }
        };

        process.stdin.on('data', onData);
    });
}

function filterUsableProfiles(profiles) {
    const result = {};
    for (const [name, profile] of Object.entries(profiles)) {
        if (!profile.requires_env || process.env[profile.requires_env]) {
            result[name] = profile;
        }
    }
    return result;
}

async function fetchModelList(profile) {
    const modelsUrl = profile.api_url.replace(/\/chat\/completions$/, '/models');
    const pqutils = require('./pq-utils.js');
    const headers = pqutils.expandEnvVars(profile.api_call_headers);

    const response = await fetch(modelsUrl, { headers });
    if (!response.ok) {
        throw new Error(`Failed to fetch models from ${modelsUrl}: ${response.status} ${response.statusText}`);
    }
    const body = await response.json();
    const models = body.data || body;
    if (!Array.isArray(models)) {
        throw new Error(`Unexpected response from ${modelsUrl}: expected array of models`);
    }
    const NON_CHAT_PATTERNS = /\b(image|img|vision|dall-e|tts|whisper|embed|embedding|moderation|audio|video)\b/i;
    return models.map(m => m.id).filter(id => !NON_CHAT_PATTERNS.test(id)).sort();
}

module.exports = { promptTextInput, promptSelection, filterUsableProfiles, fetchModelList };
