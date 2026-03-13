import { test } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { render } from 'ink-testing-library';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const pqutils = require_('../../lib/pq-utils.js');

import { App } from '../../pqueen';
import { COMMANDS } from '../../chat-ink-view.mjs';

const { SLASH_COMMANDS } = require_('../../lib/commands.js');

// Each App mounts a resize listener on process.stdout; ink cleanup is async
// so listeners accumulate across tests in the same process.
process.stdout.setMaxListeners(30);

const h = React.createElement;
// eslint-disable-next-line no-control-regex
const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, '');
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

async function waitFor(lastFrame, predicate, timeoutOrLabel = 2000, maybeLabel) {
    const timeout = typeof timeoutOrLabel === 'number' ? timeoutOrLabel : 2000;
    const label = typeof timeoutOrLabel === 'string' ? timeoutOrLabel : maybeLabel;
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (predicate(stripAnsi(lastFrame()))) return;
        await new Promise(r => setTimeout(r, 5));
    }
    const hint = label ? ` (waiting for: ${label})` : '';
    throw new Error('waitFor timed out' + hint + ': ' + JSON.stringify(stripAnsi(lastFrame())));
}

const INPUT_CONTENT = `---
connection: test
connection_profiles:
  test:
    api_url: http://dummy
dot_config_loading: false
roleplay_user: Tom
---
@Bilinda
Hello! I'm Bilinda, your surf instructor.

@Tom
`;

const SELF_CONTAINED_CONFIG = `connection: test
connection_profiles:
  test:
    api_url: http://dummy
dot_config_loading: false`;

function setupApp(content) {
    content = content || INPUT_CONTENT;
    const tmpFile = path.join(os.tmpdir(), `chat-app-test-${Date.now()}-${Math.random().toString(36).slice(2)}.pqueen`);
    fs.writeFileSync(tmpFile, content);

    const cwd = path.dirname(tmpFile);
    const doc = pqutils.parseConfigAndMessages(content);
    const resolvedConfig = pqutils.resolveConfig(doc.config, cwd);

    return {
        tmpFile,
        cleanup: () => { try { fs.unlinkSync(tmpFile); } catch { /* ignore */ } },
        props: {
            pqueenPath: tmpFile,
            cwd,
            connectionName: resolvedConfig.connection || '',
            initialMessages: doc.messages,
            resolvedConfig,
            rawConfig: doc.config,
        }
    };
}

function sseResponse(...chunks) {
    return {
        ok: true, status: 200,
        headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'text/event-stream' : null },
        body: {
            async *[Symbol.asyncIterator]() {
                for (const chunk of chunks) {
                    const data = JSON.stringify({ choices: [{ delta: { content: chunk } }] });
                    yield new TextEncoder().encode(`data: ${data}\n\n`);
                }
                yield new TextEncoder().encode(`data: [DONE]\n\n`);
            }
        }
    };
}

function errorResponse(status, body) {
    return {
        ok: false,
        status,
        text: async () => body,
    };
}

async function withFetchMock(mockFn, fn) {
    const original = global.fetch;
    global.fetch = mockFn;
    try {
        return await fn();
    } finally {
        global.fetch = original;
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test('App: initial render shows existing messages and pending speaker', async () => {
    const { props, cleanup } = setupApp();
    try {
        const { lastFrame, cleanup: inkCleanup } = render(h(App, props));
        await tick();
        const frame = stripAnsi(lastFrame());
        assert.ok(frame.includes('@Bilinda'), 'Should show Bilinda header');
        assert.ok(frame.includes('Hello'), 'Should show Bilinda content');
        assert.ok(frame.includes('@Tom'), 'Should show pending Tom header');
        inkCleanup();
    } finally {
        cleanup();
    }
});

test('App: submit sends API call and displays response', async () => {
    const { props, tmpFile, cleanup } = setupApp();
    try {
        await withFetchMock(
            async () => sseResponse('Nice to meet you, Tom!'),
            async () => {
                const { lastFrame, stdin, cleanup: inkCleanup } = render(h(App, props));
                await tick();

                stdin.write('Hey there!');
                await tick();
                stdin.write('\r'); // Enter submits
                await waitFor(lastFrame, f => f.includes('Nice to meet you'));

                const frame = stripAnsi(lastFrame());
                assert.ok(frame.includes('Nice to meet you'), 'API response should appear in frame');

                const saved = fs.readFileSync(tmpFile, 'utf8');
                assert.ok(saved.includes('Hey there!'), 'User message should be saved to file');
                assert.ok(saved.includes('Nice to meet you'), 'API response should be saved to file');

                inkCleanup();
            }
        );
    } finally {
        cleanup();
    }
});

test('App: API error shows banner, preserves conversation, and restores file', async () => {
    const { props, tmpFile, cleanup } = setupApp();
    try {
        await withFetchMock(
            async () => errorResponse(500, 'Internal Server Error'),
            async () => {
                const { lastFrame, stdin, cleanup: inkCleanup } = render(h(App, props));
                await tick();

                stdin.write('Hey there!');
                await tick();
                stdin.write('\r');
                await waitFor(lastFrame, f => f.includes('Error:'));

                const frame = stripAnsi(lastFrame());
                assert.ok(frame.includes('Error:'), 'Error banner should appear');
                assert.ok(frame.includes('500'), 'Should mention status code');
                assert.ok(frame.includes('@Bilinda'), 'Original messages should remain');
                assert.ok(frame.includes('Hello'), 'Original content should remain');

                // File should be restored — no error text written
                const saved = fs.readFileSync(tmpFile, 'utf8');
                assert.ok(!saved.includes('Internal Server Error'), 'API error should not be in file');

                inkCleanup();
            }
        );
    } finally {
        cleanup();
    }
});

test('App: API error prefills input for retry', async () => {
    const { props, cleanup } = setupApp();
    try {
        await withFetchMock(
            async () => errorResponse(500, 'Server Error'),
            async () => {
                const { lastFrame, stdin, cleanup: inkCleanup } = render(h(App, props));
                await tick();

                stdin.write('my important message');
                await tick();
                stdin.write('\r');
                await waitFor(lastFrame, f => f.includes('Error:'));

                const frame = stripAnsi(lastFrame());
                assert.ok(frame.includes('my important message'),
                    'Failed input should be prefilled in TextArea for retry');

                inkCleanup();
            }
        );
    } finally {
        cleanup();
    }
});

test('App: escape saves file and exits', async () => {
    const { props, tmpFile, cleanup } = setupApp();
    try {
        const { stdin, cleanup: inkCleanup } = render(h(App, props));
        await tick();

        stdin.write('\x1b'); // Escape
        await tick(150); // ink needs time to distinguish standalone Esc from sequences

        const saved = fs.readFileSync(tmpFile, 'utf8');
        assert.ok(saved.includes('Bilinda'), 'File should contain original messages after save');
        assert.ok(saved.includes('Hello'), 'File should contain message content');

        inkCleanup();
    } finally {
        cleanup();
    }
});

test('App: multi-chunk streaming accumulates response', async () => {
    const { props, tmpFile, cleanup } = setupApp();
    try {
        await withFetchMock(
            async () => sseResponse('Hello ', 'there ', 'Tom!'),
            async () => {
                const { lastFrame, stdin, cleanup: inkCleanup } = render(h(App, props));
                await tick();

                stdin.write('Hi');
                await tick();
                stdin.write('\r');
                await waitFor(lastFrame, f => f.includes('Hello there Tom!'));

                const frame = stripAnsi(lastFrame());
                assert.ok(frame.includes('Hello there Tom!'),
                    'All chunks should be accumulated into the final response');

                const saved = fs.readFileSync(tmpFile, 'utf8');
                assert.ok(saved.includes('Hello there Tom!'),
                    'Accumulated response should be saved to file');

                inkCleanup();
            }
        );
    } finally {
        cleanup();
    }
});

test('App: postCompletionLint adds next speaker after response', async () => {
    const { props, tmpFile, cleanup } = setupApp();
    try {
        await withFetchMock(
            async () => sseResponse('Catch some waves!'),
            async () => {
                const { lastFrame, stdin, cleanup: inkCleanup } = render(h(App, props));
                await tick();

                stdin.write('Teach me to surf');
                await tick();
                stdin.write('\r');
                await waitFor(lastFrame, f => f.includes('Catch some waves!'));

                const frame = stripAnsi(lastFrame());
                // After Bilinda responds, postCompletionLint should add @Tom as next pending speaker
                assert.ok(frame.includes('Catch some waves!'), 'Response should appear');

                const saved = fs.readFileSync(tmpFile, 'utf8');
                // The saved file should end with the next speaker marker
                const afterResponse = saved.slice(saved.lastIndexOf('Catch some waves!'));
                assert.ok(afterResponse.includes('@Tom'),
                    'postCompletionLint should add @Tom as next speaker after Bilinda responds');

                inkCleanup();
            }
        );
    } finally {
        cleanup();
    }
});

test('App: AbortError shows cancellation message', async () => {
    const { props, cleanup } = setupApp();
    try {
        await withFetchMock(
            async () => { const err = new Error('aborted'); err.name = 'AbortError'; throw err; },
            async () => {
                const { lastFrame, stdin, cleanup: inkCleanup } = render(h(App, props));
                await tick();

                stdin.write('Hello');
                await tick();
                stdin.write('\r');
                await waitFor(lastFrame, f => f.includes('Request cancelled'));

                const frame = stripAnsi(lastFrame());
                assert.ok(frame.includes('Request cancelled'),
                    'AbortError should show "Request cancelled" not generic error');
                assert.ok(!frame.includes('Error:'),
                    'Should not show "Error:" prefix for cancellation');

                inkCleanup();
            }
        );
    } finally {
        cleanup();
    }
});

test('App: mid-stream API failure restores state and prefills input', async () => {
    const { props, tmpFile, cleanup } = setupApp();
    try {
        const midStreamError = () => ({
            ok: true, status: 200,
            headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'text/event-stream' : null },
            body: {
                async *[Symbol.asyncIterator]() {
                    const data = JSON.stringify({ choices: [{ delta: { content: 'partial response' } }] });
                    yield new TextEncoder().encode(`data: ${data}\n\n`);
                    throw new Error('Connection reset');
                }
            }
        });

        await withFetchMock(
            async () => midStreamError(),
            async () => {
                const { lastFrame, stdin, cleanup: inkCleanup } = render(h(App, props));
                await tick();

                stdin.write('my message');
                await tick();
                stdin.write('\r');
                await waitFor(lastFrame, f => f.includes('Connection reset'));

                const frame = stripAnsi(lastFrame());
                assert.ok(frame.includes('Error:'), 'Error banner should appear');
                assert.ok(frame.includes('Connection reset'), 'Should show the error message');

                // Original conversation should be restored, not the partial response
                assert.ok(frame.includes('@Bilinda'), 'Original messages should remain');
                assert.ok(frame.includes('my message'),
                    'Failed input should be prefilled for retry');

                // File should be restored to pre-submit state
                const saved = fs.readFileSync(tmpFile, 'utf8');
                assert.ok(!saved.includes('partial response'),
                    'Partial stream content should not be saved to file');

                inkCleanup();
            }
        );
    } finally {
        cleanup();
    }
});

test('App: writeFileSync failure on save shows error and preserves state', async () => {
    const { props, tmpFile, cleanup } = setupApp();
    try {
        await withFetchMock(
            async () => sseResponse('Great response!'),
            async () => {
                const { lastFrame, stdin, cleanup: inkCleanup } = render(h(App, props));
                await tick();

                // Sabotage writeFileSync to fail once on the post-response save
                const origWriteFileSync = fs.writeFileSync;
                let callCount = 0;
                let failed = false;
                fs.writeFileSync = function(...args) {
                    callCount++;
                    // Allow the first save (user message submit), fail exactly the second (post-response save),
                    // then allow the recovery save in the catch block
                    if (callCount === 2 && !failed && String(args[0]) === tmpFile) {
                        failed = true;
                        throw new Error('EACCES: permission denied');
                    }
                    return origWriteFileSync.apply(this, args);
                };

                try {
                    stdin.write('Hello');
                    await tick();
                    stdin.write('\r');
                    await waitFor(lastFrame, f => f.includes('EACCES'));

                    const frame = stripAnsi(lastFrame());
                    assert.ok(frame.includes('EACCES'),
                        'Should show the write error message');
                } finally {
                    fs.writeFileSync = origWriteFileSync;
                }

                inkCleanup();
            }
        );
    } finally {
        cleanup();
    }
});

test('App: /exit command saves and exits', async () => {
    const { props, tmpFile, cleanup } = setupApp();
    try {
        const { stdin, cleanup: inkCleanup } = render(h(App, props));
        await tick();

        stdin.write('/exit');
        await tick();
        stdin.write('\r');
        await tick(50);

        const saved = fs.readFileSync(tmpFile, 'utf8');
        assert.ok(saved.includes('Bilinda'), 'File should be saved before exit');
        assert.ok(saved.includes('Hello'), 'File should contain message content');

        inkCleanup();
    } finally {
        cleanup();
    }
});

test('App: /regenerate re-requests last assistant message', async () => {
    const { props, tmpFile, cleanup } = setupApp();
    let fetchCount = 0;
    try {
        await withFetchMock(
            async () => {
                fetchCount++;
                if (fetchCount === 1) return sseResponse('First response');
                return sseResponse('Regenerated response');
            },
            async () => {
                const { lastFrame, stdin, cleanup: inkCleanup } = render(h(App, props));
                await tick();

                // First turn: send a message and get a response
                stdin.write('Hi');
                await tick();
                stdin.write('\r');
                await waitFor(lastFrame, f => f.includes('First response'), 'first response');

                // Now regenerate
                stdin.write('/regenerate');
                await tick();
                stdin.write('\r');
                await waitFor(lastFrame, f => f.includes('Regenerated response'), 'regenerated response');

                const frame = stripAnsi(lastFrame());
                assert.ok(frame.includes('Regenerated response'),
                    'Regenerated response should appear');

                const saved = fs.readFileSync(tmpFile, 'utf8');
                assert.ok(saved.includes('Regenerated response'),
                    'Regenerated response should be saved to file');
                assert.ok(!saved.includes('First response'),
                    'Original response should not be in file');

                inkCleanup();
            }
        );
    } finally {
        cleanup();
    }
});

test('App: multi-turn conversation works correctly', async () => {
    const { props, tmpFile, cleanup } = setupApp();
    let fetchCount = 0;
    try {
        await withFetchMock(
            async () => {
                fetchCount++;
                if (fetchCount === 1) return sseResponse('Reply one');
                return sseResponse('Reply two');
            },
            async () => {
                const { lastFrame, stdin, cleanup: inkCleanup } = render(h(App, props));
                await tick();

                // First turn
                stdin.write('Message one');
                await tick();
                stdin.write('\r');
                await waitFor(lastFrame, f => f.includes('Reply one'), 'first reply');

                // Second turn — postCompletionLint should have added @Tom as pending
                stdin.write('Message two');
                await tick();
                stdin.write('\r');
                await waitFor(lastFrame, f => f.includes('Reply two'), 'second reply');

                const frame = stripAnsi(lastFrame());
                assert.ok(frame.includes('Reply one'), 'First reply should still be visible');
                assert.ok(frame.includes('Reply two'), 'Second reply should appear');

                const saved = fs.readFileSync(tmpFile, 'utf8');
                assert.ok(saved.includes('Message one'), 'First user message saved');
                assert.ok(saved.includes('Reply one'), 'First reply saved');
                assert.ok(saved.includes('Message two'), 'Second user message saved');
                assert.ok(saved.includes('Reply two'), 'Second reply saved');
                assert.strictEqual(fetchCount, 2, 'Should have made exactly 2 API calls');

                inkCleanup();
            }
        );
    } finally {
        cleanup();
    }
});

test('App: streaming content is visible before completion', async () => {
    const { props, cleanup } = setupApp();
    try {
        let resolveSecondChunk;
        const slowStream = () => ({
            ok: true, status: 200,
            headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'text/event-stream' : null },
            body: {
                async *[Symbol.asyncIterator]() {
                    const data1 = JSON.stringify({ choices: [{ delta: { content: 'partial content visible' } }] });
                    yield new TextEncoder().encode(`data: ${data1}\n\n`);
                    // Wait before sending done so we can observe the partial state
                    await new Promise(r => { resolveSecondChunk = r; });
                    yield new TextEncoder().encode(`data: [DONE]\n\n`);
                }
            }
        });

        await withFetchMock(
            async () => slowStream(),
            async () => {
                const { lastFrame, stdin, cleanup: inkCleanup } = render(h(App, props));
                await tick();

                stdin.write('Hi');
                await tick();
                stdin.write('\r');
                await waitFor(lastFrame, f => f.includes('partial content visible'), 'streaming partial');

                // Stream is still in progress — verify partial content is displayed
                const frame = stripAnsi(lastFrame());
                assert.ok(frame.includes('partial content visible'),
                    'Partial streaming content should be visible before stream completes');

                // Let the stream finish
                resolveSecondChunk();
                await tick(50);

                inkCleanup();
            }
        );
    } finally {
        cleanup();
    }
});

test('App: unknown slash command is submitted as regular text', async () => {
    const { props, tmpFile, cleanup } = setupApp();
    try {
        await withFetchMock(
            async () => sseResponse('Got it!'),
            async () => {
                const { lastFrame, stdin, cleanup: inkCleanup } = render(h(App, props));
                await tick();

                stdin.write('/foo');
                await tick();
                stdin.write('\r');
                await waitFor(lastFrame, f => f.includes('Got it!'), 'response to unknown command');

                const saved = fs.readFileSync(tmpFile, 'utf8');
                assert.ok(saved.includes('/foo'),
                    'Unknown command should be submitted as literal message text');
                assert.ok(saved.includes('Got it!'),
                    'API response should be saved');

                inkCleanup();
            }
        );
    } finally {
        cleanup();
    }
});

test('App: escape during busy state is ignored', async () => {
    const { props, tmpFile, cleanup } = setupApp();
    try {
        // Use a slow response so we can press escape while streaming
        const slowResponse = () => ({
            ok: true, status: 200,
            headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'text/event-stream' : null },
            body: {
                async *[Symbol.asyncIterator]() {
                    const data = JSON.stringify({ choices: [{ delta: { content: 'streaming...' } }] });
                    yield new TextEncoder().encode(`data: ${data}\n\n`);
                    await new Promise(r => setTimeout(r, 50));
                    yield new TextEncoder().encode(`data: [DONE]\n\n`);
                }
            }
        });

        await withFetchMock(
            async () => slowResponse(),
            async () => {
                const { lastFrame, stdin, cleanup: inkCleanup } = render(h(App, props));
                await tick();

                stdin.write('Hi');
                await tick();
                stdin.write('\r');
                await waitFor(lastFrame, f => f.includes('streaming'));

                // Press escape while busy (stream hasn't finished yet)
                stdin.write('\x1b');
                await tick(150); // ink Esc disambiguation delay

                // Should still be running — verify the frame still shows streaming content
                const frameDuring = stripAnsi(lastFrame());
                assert.ok(frameDuring.includes('streaming'),
                    'Stream should continue despite escape press');

                // Wait for stream to finish and file to be saved
                await waitFor(lastFrame, f => !f.includes('Sending'), 2000);
                await tick();

                // File should contain the response, not be in a saved-and-exited state
                const saved = fs.readFileSync(tmpFile, 'utf8');
                assert.ok(saved.includes('streaming'),
                    'Response should be saved — escape during busy should not exit');

                inkCleanup();
            }
        );
    } finally {
        cleanup();
    }
});

// ─── Edge-case .pqueen file loading tests ────────────────────────────────────

test('App: simple prompt with standard role names (user/assistant)', async () => {
    const content = `---\n${SELF_CONTAINED_CONFIG}\n---\n@system\nYou are helpful.\n\n@user\n`;
    const { props, tmpFile, cleanup } = setupApp(content);
    try {
        await withFetchMock(
            async () => sseResponse('I can help!'),
            async () => {
                const { lastFrame, stdin, cleanup: inkCleanup } = render(h(App, props));
                await tick();

                const frame = stripAnsi(lastFrame());
                assert.ok(frame.includes('@system') || frame.includes('You are helpful'),
                    'System message should be visible');
                assert.ok(frame.includes('@user'), 'Pending @user should be visible');

                stdin.write('Hello');
                await tick();
                stdin.write('\r');
                await waitFor(lastFrame, f => f.includes('I can help!'), 'response');

                const saved = fs.readFileSync(tmpFile, 'utf8');
                assert.ok(saved.includes('Hello'), 'User message saved');
                assert.ok(saved.includes('I can help!'), 'Response saved');
                // File should end with a pending @user for the next turn
                assert.ok(saved.trimEnd().endsWith('@user'),
                    'File should end with pending @user marker');

                inkCleanup();
            }
        );
    } finally {
        cleanup();
    }
});

test('App: system-only file (no user message) shows last message as prefill', async () => {
    const content = `---\n${SELF_CONTAINED_CONFIG}\n---\n@system\nYou are helpful.`;
    const { props, cleanup } = setupApp(content);
    try {
        const { lastFrame, cleanup: inkCleanup } = render(h(App, props));
        await tick();

        const frame = stripAnsi(lastFrame());
        // The system message should become pendingMsg with content prefilled
        // (splitMessages sees all messages have content → no pending →
        //  init logic pops the last message and prefills its content)
        assert.ok(frame.includes('You are helpful'),
            'System message content should be prefilled in the text area');

        inkCleanup();
    } finally {
        cleanup();
    }
});

test('App: mid-conversation file with all messages filled triggers prefill', async () => {
    const content = `---\n${SELF_CONTAINED_CONFIG}\nroleplay_user: Tom\n---\n@Bilinda\nHello!\n\n@Tom\nHi there!\n\n@Bilinda\nHow are you?`;
    const { props, cleanup } = setupApp(content);
    try {
        const { lastFrame, cleanup: inkCleanup } = render(h(App, props));
        await tick();

        const frame = stripAnsi(lastFrame());
        // Last message (Bilinda's "How are you?") should be popped and prefilled
        assert.ok(frame.includes('How are you?'),
            'Last message content should be prefilled for editing');
        // The previous messages should be in the completed list
        assert.ok(frame.includes('Hello!'), 'Earlier messages should be visible');
        assert.ok(frame.includes('Hi there!'), 'Tom message should be visible');

        inkCleanup();
    } finally {
        cleanup();
    }
});

test('App: file with no messages (frontmatter only) renders without crash', async () => {
    const content = `---\n${SELF_CONTAINED_CONFIG}\n---\n`;
    const { props, cleanup } = setupApp(content);
    try {
        const { lastFrame, cleanup: inkCleanup } = render(h(App, props));
        await tick();

        const frame = stripAnsi(lastFrame());
        // Should render the text input area at minimum
        assert.ok(frame.includes('Enter send') || frame.includes('quit'),
            'Status hint should be visible even with no messages');

        inkCleanup();
    } finally {
        cleanup();
    }
});

test('App: file with single @user message and no system prompt', async () => {
    const content = `---\n${SELF_CONTAINED_CONFIG}\n---\n@user\n`;
    const { props, tmpFile, cleanup } = setupApp(content);
    try {
        await withFetchMock(
            async () => sseResponse('Hi there!'),
            async () => {
                const { lastFrame, stdin, cleanup: inkCleanup } = render(h(App, props));
                await tick();

                const frame = stripAnsi(lastFrame());
                assert.ok(frame.includes('@user'), 'Pending @user should be visible');

                stdin.write('Hello world');
                await tick();
                stdin.write('\r');
                await waitFor(lastFrame, f => f.includes('Hi there!'), 'response');

                const saved = fs.readFileSync(tmpFile, 'utf8');
                assert.ok(saved.includes('Hello world'), 'User message saved');
                assert.ok(saved.includes('Hi there!'), 'Response saved');

                inkCleanup();
            }
        );
    } finally {
        cleanup();
    }
});

test('App: file with assistant as last message creates pending user turn', async () => {
    // When the user fills a pending @assistant message, precompletionLint
    // determines the next speaker is @user, so no LLM call happens —
    // instead a new pending @user is created for the human to fill in.
    const content = `---\n${SELF_CONTAINED_CONFIG}\n---\n@system\nBe helpful.\n\n@user\nHello!\n\n@assistant\n`;
    const { props, tmpFile, cleanup } = setupApp(content);
    try {
        const { lastFrame, stdin, cleanup: inkCleanup } = render(h(App, props));
        await tick();

        const frame = stripAnsi(lastFrame());
        assert.ok(frame.includes('@assistant'), 'Pending @assistant should be visible');
        assert.ok(frame.includes('Hello!'), 'User message should be visible');

        // Fill the assistant message — this should NOT trigger LLM call,
        // instead it should create a pending @user turn
        stdin.write('I am here to help.');
        await tick();
        stdin.write('\r');
        await waitFor(lastFrame, f => f.includes('@user') && f.includes('I am here to help.'),
            'pending user after assistant fill');

        const saved = fs.readFileSync(tmpFile, 'utf8');
        assert.ok(saved.includes('I am here to help.'), 'Assistant content saved');
        assert.ok(saved.trimEnd().endsWith('@user'),
            'File should end with pending @user after assistant message is filled');

        inkCleanup();
    } finally {
        cleanup();
    }
});

test('App: multi-turn with standard roles preserves correct file structure', async () => {
    const content = `---\n${SELF_CONTAINED_CONFIG}\n---\n@system\nYou are helpful.\n\n@user\n`;
    const { props, tmpFile, cleanup } = setupApp(content);
    let fetchCount = 0;
    try {
        await withFetchMock(
            async () => {
                fetchCount++;
                return sseResponse(`Reply ${fetchCount}`);
            },
            async () => {
                const { lastFrame, stdin, cleanup: inkCleanup } = render(h(App, props));
                await tick();

                // First turn
                stdin.write('First message');
                await tick();
                stdin.write('\r');
                await waitFor(lastFrame, f => f.includes('Reply 1'), 'first reply');

                // Second turn
                stdin.write('Second message');
                await tick();
                stdin.write('\r');
                await waitFor(lastFrame, f => f.includes('Reply 2'), 'second reply');

                const saved = fs.readFileSync(tmpFile, 'utf8');
                assert.ok(saved.includes('First message'), 'First message saved');
                assert.ok(saved.includes('Reply 1'), 'First reply saved');
                assert.ok(saved.includes('Second message'), 'Second message saved');
                assert.ok(saved.includes('Reply 2'), 'Second reply saved');
                // File should end with pending @user
                assert.ok(saved.trimEnd().endsWith('@user'),
                    'File should end with pending @user for next turn');

                inkCleanup();
            }
        );
    } finally {
        cleanup();
    }
});

test('App: file with decorators on messages renders correctly', async () => {
    const content = `---\n${SELF_CONTAINED_CONFIG}\nroleplay_user: Tom\n---\n@Bilinda [happy]\nHello!\n\n@Tom\n`;
    const { props, cleanup } = setupApp(content);
    try {
        const { lastFrame, cleanup: inkCleanup } = render(h(App, props));
        await tick();

        const frame = stripAnsi(lastFrame());
        assert.ok(frame.includes('Hello!'), 'Decorated message content should be visible');
        assert.ok(frame.includes('@Tom'), 'Pending Tom should be visible');

        inkCleanup();
    } finally {
        cleanup();
    }
});

test('App: save roundtrip preserves file structure', async () => {
    const content = `---\n${SELF_CONTAINED_CONFIG}\n---\n@system\nBe helpful.\n\n@user\n`;
    const { props, tmpFile, cleanup } = setupApp(content);
    try {
        const { stdin, cleanup: inkCleanup } = render(h(App, props));
        await tick();

        // Exit immediately to trigger a save
        stdin.write('/exit');
        await tick();
        stdin.write('\r');
        await tick(50);

        const saved = fs.readFileSync(tmpFile, 'utf8');
        assert.ok(saved.startsWith('---\n'), 'Should start with frontmatter marker');
        assert.ok(saved.includes('connection: test'), 'Connection should be preserved');
        assert.ok(saved.includes('@system'), 'System message should be preserved');
        assert.ok(saved.includes('Be helpful'), 'System content should be preserved');
        assert.ok(saved.includes('@user'), 'User marker should be preserved');

        // Re-parse the saved file to ensure it's valid
        const doc = pqutils.parseConfigAndMessages(saved);
        assert.ok(doc.messages.length >= 2, 'Re-parsed file should have at least 2 messages');

        inkCleanup();
    } finally {
        cleanup();
    }
});

test('slash command lists stay in sync', () => {
    const handlerCommands = new Set(Object.keys(SLASH_COMMANDS));
    const autocompleteCommands = new Set(COMMANDS.map(c => c.name));

    for (const cmd of handlerCommands) {
        assert.ok(autocompleteCommands.has(cmd),
            `Command ${cmd} is handled in SLASH_COMMANDS but missing from COMMANDS in chat-ink-view.mjs`);
    }
    for (const cmd of autocompleteCommands) {
        assert.ok(handlerCommands.has(cmd),
            `Command ${cmd} is in COMMANDS but has no handler in SLASH_COMMANDS`);
    }
});
