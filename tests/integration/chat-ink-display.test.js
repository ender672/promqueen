const { test, mock } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { precompletionLint } = require('../../pre-completion-lint.js');
const { postCompletionLint } = require('../../post-completion-lint.js');
const { preparePrompt, dispatchSendPrompt } = require('../../lib/pipeline.js');
const pqutils = require('../../lib/pq-utils.js');
const { displayConversation, computeInitialDisplayPos, ensureReadyForUserInput } = require('../../lib/chat-utils.js');

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

// ─── runChatTurn (matches chat.mjs) ─────────────────────────────────────

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

async function simulateSession(inputContent, userMessages, responseMaker) {
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

        // Mock fetch
        let turnIdx = 0;
        const fetchMock = mock.fn(async () => responseMaker(turnIdx++));
        const originalFetch = global.fetch;
        global.fetch = fetchMock;

        try {
            // Phase 2: simulate each user turn
            for (const userText of userMessages) {
                const fileContent = store.read();
                const undisplayed = fileContent.slice(displayPos);
                screen += undisplayed;
                screen += userText;
                if (!userText.endsWith('\n')) screen += '\n';

                store.append(userText);
                if (!userText.endsWith('\n')) store.append('\n');
                displayPos = store.read().length;

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

        return { screen, fileContent: store.read(), fetchMock };
    } finally {
        fs.unlinkSync(tmpFile);
    }
}

// ─── Response helpers ───────────────────────────────────────────────────────

function sseResponseMaker(responseLines) {
    return (turnIdx) => ({
        ok: true, status: 200,
        headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'text/event-stream' : null },
        body: {
            async *[Symbol.asyncIterator]() {
                yield sseChunk(responseLines[turnIdx]);
                yield sseChunk('[DONE]');
            }
        }
    });
}

function errorResponseMaker(statusCode, errorBody) {
    return () => ({
        ok: false,
        status: statusCode,
        text: async () => errorBody,
    });
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

        const { screen } = await simulateSession(inputContent, userMessages, sseResponseMaker(responseLines));

        assert.strictEqual(screen, expectedScreen,
            `Screen output mismatch for ${baseName}.\n` +
            `Expected:\n${JSON.stringify(expectedScreen)}\n` +
            `Got:\n${JSON.stringify(screen)}`
        );
    });
}

// ─── Error path tests ───────────────────────────────────────────────────────

test('chat-ink display: api-error rolls back and shows error', async () => {
    const inputContent = `---
connection: test
connection_profiles:
  test:
    api_url: http://dummy
dot_config_loading: false
roleplay_user: Tom
---
@Bilinda
Hello! I'm Bilinda, your surf instructor.
`;
    const userMessages = ['Hey there!'];

    const { screen, fileContent } = await simulateSession(
        inputContent,
        userMessages,
        errorResponseMaker(500, 'Internal Server Error')
    );

    // Screen should show the error message
    assert.ok(screen.includes('Error:'), 'Screen should contain error message');
    assert.ok(screen.includes('500'), 'Screen should contain status code');

    // User text persists (it's appended before the API call), but the
    // assistant turn is rolled back — no assistant content in the file.
    assert.ok(fileContent.includes('Hey there!'),
        'User text should persist in the file');
    assert.ok(!fileContent.includes('Internal Server Error'),
        'API error text should not be written to the file');
});

test('chat-ink display: api-error preserves prior conversation', async () => {
    const inputContent = `---
connection: test
connection_profiles:
  test:
    api_url: http://dummy
dot_config_loading: false
roleplay_user: Tom
---
@Bilinda
Hello! I'm Bilinda, your surf instructor.
`;
    const userMessages = ['Hey there!'];

    const { screen } = await simulateSession(
        inputContent,
        userMessages,
        errorResponseMaker(429, 'Rate limit exceeded')
    );

    // The original conversation should still be visible
    assert.ok(screen.includes('@Bilinda'), 'Original messages should remain on screen');
    assert.ok(screen.includes('Hello! I\'m Bilinda'), 'Original content should remain on screen');
    assert.ok(screen.includes('429'), 'Error should mention status code');
});
