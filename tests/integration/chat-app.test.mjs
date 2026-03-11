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

function sseResponse(content) {
    const data = JSON.stringify({ choices: [{ delta: { content } }] });
    return {
        ok: true, status: 200,
        headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'text/event-stream' : null },
        body: {
            async *[Symbol.asyncIterator]() {
                yield new TextEncoder().encode(`data: ${data}\n\n`);
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
