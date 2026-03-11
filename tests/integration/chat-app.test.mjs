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

const h = React.createElement;
const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, '');
const tick = (ms = 50) => new Promise(r => setTimeout(r, ms));

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
        cleanup: () => { try { fs.unlinkSync(tmpFile); } catch {} },
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
                stdin.write('\x04'); // Ctrl+D submits
                await tick(500);

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

test('App: API error shows error banner and restores file', async () => {
    const { props, tmpFile, cleanup } = setupApp();
    try {
        await withFetchMock(
            async () => errorResponse(500, 'Internal Server Error'),
            async () => {
                const { lastFrame, stdin, cleanup: inkCleanup } = render(h(App, props));
                await tick();

                stdin.write('Hey there!');
                await tick();
                stdin.write('\x04');
                await tick(500);

                const frame = stripAnsi(lastFrame());
                assert.ok(frame.includes('Error:'), 'Error banner should appear');
                assert.ok(frame.includes('500'), 'Should mention status code');

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

test('App: API error preserves original conversation in frame', async () => {
    const { props, cleanup } = setupApp();
    try {
        await withFetchMock(
            async () => errorResponse(429, 'Rate limit exceeded'),
            async () => {
                const { lastFrame, stdin, cleanup: inkCleanup } = render(h(App, props));
                await tick();

                stdin.write('Hey');
                await tick();
                stdin.write('\x04');
                await tick(500);

                const frame = stripAnsi(lastFrame());
                assert.ok(frame.includes('@Bilinda'), 'Original messages should remain');
                assert.ok(frame.includes('Hello'), 'Original content should remain');
                assert.ok(frame.includes('429'), 'Error should mention status code');

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
                stdin.write('\x04');
                await tick(500);

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
        await tick(200); // ink needs time to distinguish standalone Esc from sequences

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
                stdin.write('\x04');
                await tick(500);

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
                stdin.write('\x04');
                await tick(500);

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
                stdin.write('\x04');
                await tick(500);

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
                stdin.write('\x04');
                await tick(500);

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
                    stdin.write('\x04');
                    await tick(500);

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
                    await new Promise(r => setTimeout(r, 300));
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
                stdin.write('\x04');
                await tick(100); // mid-stream

                // Press escape while busy
                stdin.write('\x1b');
                await tick(200);

                // Should still be running — verify the frame still shows streaming content
                const frameDuring = stripAnsi(lastFrame());
                assert.ok(frameDuring.includes('streaming'),
                    'Stream should continue despite escape press');

                // Wait for stream to finish
                await tick(500);

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
