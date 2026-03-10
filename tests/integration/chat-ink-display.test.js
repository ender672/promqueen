const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { precompletionLint } = require('../../pre-completion-lint.js');
const { postCompletionLint } = require('../../post-completion-lint.js');
const { preparePrompt, dispatchSendPrompt } = require('../../lib/pipeline.js');
const pqutils = require('../../lib/pq-utils.js');

// ─── Helpers ────────────────────────────────────────────────────────────────

function sseChunk(data) {
    return new TextEncoder().encode(`data: ${data}\n\n`);
}

function createFileStore(absolutePath) {
    return {
        read() { return fs.readFileSync(absolutePath, 'utf8'); },
        append(text) { fs.appendFileSync(absolutePath, text); },
        size() { return fs.statSync(absolutePath).size; },
        truncate(byteLength) { fs.truncateSync(absolutePath, byteLength); },
    };
}

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

// ─── displayConversation (matches chat-ink.mjs) ─────────────────────────────

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

// ─── runChatTurn (matches chat-ink.mjs) ─────────────────────────────────────

async function runChatTurn(store, cwd, writeFn, cliConfig) {
    const snapshotSize = store.size();

    let content = store.read();
    let doc = pqutils.parseConfigAndMessages(content);
    const resolvedConfig = pqutils.resolveConfig(doc.config, cwd, cliConfig);

    const preOutput = precompletionLint(doc.messages, resolvedConfig);
    if (preOutput) {
        store.append(preOutput);
        writeFn(preOutput);
    }

    const apiMessages = preparePrompt(doc.messages, resolvedConfig, cwd, cwd);

    const chunks = [];
    const teeStream = {
        write(chunk) {
            writeFn(chunk);
            chunks.push(chunk);
        }
    };

    const controller = new AbortController();

    let pricingResult;
    try {
        pricingResult = await dispatchSendPrompt(apiMessages, resolvedConfig, teeStream, cwd, { signal: controller.signal });
    } catch (err) {
        store.truncate(snapshotSize);
        writeFn(`\nError: ${err.message}\n`);
        return { failed: true };
    }

    store.append(chunks.join(''));

    const cur = store.read();
    if (!cur.endsWith('\n')) {
        store.append('\n');
        writeFn('\n');
    }

    let displayPos = store.read().length;
    content = store.read();
    doc = pqutils.parseConfigAndMessages(content);
    const postConfig = { ...resolvedConfig, user: resolvedConfig.user || resolvedConfig.roleplay_user };
    const postOutput = postCompletionLint(doc.messages, postConfig);
    if (postOutput) {
        store.append(postOutput);
        const paddingMatch = postOutput.match(/^(\n+)/);
        if (paddingMatch) {
            writeFn(paddingMatch[1]);
            displayPos += paddingMatch[1].length;
        }
    }

    return { failed: false, pricingResult, displayPos };
}

// ─── Full chat-ink session simulator ────────────────────────────────────────

async function simulateSession(inputContent, userMessages, responseLines) {
    const tmpFile = path.join(os.tmpdir(), `chat-ink-sim-${Date.now()}-${Math.random().toString(36).slice(2)}.pqueen`);
    fs.writeFileSync(tmpFile, inputContent);

    try {
        const store = createFileStore(tmpFile);
        const cwd = path.dirname(tmpFile);
        const content = store.read();
        const doc = pqutils.parseConfigAndMessages(content);
        const resolvedConfig = pqutils.resolveConfig(doc.config, cwd);
        const userName = resolvedConfig.roleplay_user || 'user';

        // Phase 1: display existing conversation
        let screen = displayConversation(content, doc);
        let displayPos = computeInitialDisplayPos(content);
        ensureReadyForUserInput(store, userName);

        // Mock fetch — serves one response line per turn
        let turnIdx = 0;
        const originalFetch = global.fetch;
        global.fetch = async () => {
            const line = responseLines[turnIdx++];
            return {
                ok: true, status: 200,
                headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'text/event-stream' : null },
                body: {
                    async *[Symbol.asyncIterator]() {
                        yield sseChunk(line);
                        yield sseChunk('[DONE]');
                    }
                }
            };
        };

        try {
            // Phase 2: simulate each user turn
            for (const userText of userMessages) {
                // Effect logic: display undisplayed content + user text
                const fileContent = store.read();
                const undisplayed = fileContent.slice(displayPos);
                screen += undisplayed;
                screen += userText;
                if (!userText.endsWith('\n')) screen += '\n';

                // Append to file
                store.append(userText);
                if (!userText.endsWith('\n')) store.append('\n');
                displayPos = store.read().length;

                // Run chat turn
                const turnOutput = [];
                const result = await runChatTurn(store, cwd, (s) => turnOutput.push(s), {});
                screen += turnOutput.join('');

                if (!result.failed) {
                    displayPos = result.displayPos;
                    ensureReadyForUserInput(store, userName);
                }
            }
        } finally {
            global.fetch = originalFetch;
        }

        return { screen, fileContent: store.read() };
    } finally {
        fs.unlinkSync(tmpFile);
    }
}

// ─── Fixture-driven tests ───────────────────────────────────────────────────

const fixturesDir = path.join(__dirname, '../fixtures/chat-ink-display');
const inputFiles = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.input.pqueen'));

for (const inputFile of inputFiles) {
    const baseName = inputFile.replace('.input.pqueen', '');
    const messagesFile = path.join(fixturesDir, `${baseName}.messages.json`);
    const responsesFile = path.join(fixturesDir, `${baseName}.responses.ndjson`);
    const screenFile = path.join(fixturesDir, `${baseName}.screen.txt`);

    if (!fs.existsSync(screenFile)) continue;

    test(`chat-ink display: ${baseName}`, async () => {
        const inputContent = fs.readFileSync(path.join(fixturesDir, inputFile), 'utf8');
        const userMessages = JSON.parse(fs.readFileSync(messagesFile, 'utf8'));
        const responseLines = fs.readFileSync(responsesFile, 'utf8').trim().split('\n');
        const expectedScreen = fs.readFileSync(screenFile, 'utf8');

        const { screen } = await simulateSession(inputContent, userMessages, responseLines);

        assert.strictEqual(screen, expectedScreen,
            `Screen output mismatch for ${baseName}.\n` +
            `Expected:\n${JSON.stringify(expectedScreen)}\n` +
            `Got:\n${JSON.stringify(screen)}`
        );
    });
}
