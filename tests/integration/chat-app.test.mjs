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

import { App } from '../../chat.mjs';

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

function setupApp() {
    const tmpFile = path.join(os.tmpdir(), `chat-app-test-${Date.now()}-${Math.random().toString(36).slice(2)}.pqueen`);
    fs.writeFileSync(tmpFile, INPUT_CONTENT);

    const cwd = path.dirname(tmpFile);
    const doc = pqutils.parseConfigAndMessages(INPUT_CONTENT);
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
