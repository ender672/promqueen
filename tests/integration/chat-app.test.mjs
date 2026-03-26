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

import { App } from '../../pqueen.mjs';
import { COMMANDS } from '../../chat-ink-view.mjs';

const { SLASH_COMMANDS } = require_('../../lib/commands.js');

// Each App mounts a resize listener on process.stdout; ink cleanup is async
// so listeners accumulate across tests in the same process.
process.stdout.setMaxListeners(30);

const h = React.createElement;
// eslint-disable-next-line no-control-regex
const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, '');
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

async function waitFor(lastFrame, predicate, label) {
    const timeout = 2000;
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

const testContent = (body) => `---\n${SELF_CONTAINED_CONFIG}\n---\n${body}`;

function errorResponse(status, body) {
    return { ok: false, status, text: async () => body };
}

function streamingResponse(chunks, { throwAfter } = {}) {
    return {
        ok: true, status: 200,
        headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'text/event-stream' : null },
        body: {
            async *[Symbol.asyncIterator]() {
                for (const chunk of chunks) {
                    if (chunk.wait) { await chunk.wait; continue; }
                    if (chunk.delay) { await new Promise(r => setTimeout(r, chunk.delay)); continue; }
                    const data = JSON.stringify({ choices: [{ delta: { content: chunk } }] });
                    yield new TextEncoder().encode(`data: ${data}\n\n`);
                }
                if (throwAfter) throw throwAfter;
                yield new TextEncoder().encode(`data: [DONE]\n\n`);
            }
        }
    };
}

// Unified test harness: sets up tmp file, renders App, mocks fetch, cleans up.
async function withApp(contentOrOpts, fn) {
    const opts = typeof contentOrOpts === 'string' ? { content: contentOrOpts }
        : (contentOrOpts || {});
    const content = opts.content || INPUT_CONTENT;
    const fetchMock = opts.fetch || null;

    const tmpFile = path.join(os.tmpdir(), `chat-app-test-${Date.now()}-${Math.random().toString(36).slice(2)}.pqueen`);
    fs.writeFileSync(tmpFile, content);

    const cwd = path.dirname(tmpFile);
    const doc = pqutils.parseConfigAndMessages(content);
    const resolvedConfig = pqutils.resolveConfig(doc.config, cwd);
    const props = {
        pqueenPath: tmpFile, cwd,
        connectionName: resolvedConfig.connection || '',
        initialMessages: doc.messages, resolvedConfig, rawConfig: doc.config,
    };

    const run = async () => {
        const { lastFrame, stdin, cleanup: inkCleanup } = render(h(App, props));
        await tick();
        const frame = () => stripAnsi(lastFrame());
        const readFile = () => fs.readFileSync(tmpFile, 'utf8');
        const typeAndSubmit = async (text) => { stdin.write(text); await tick(); stdin.write('\r'); };
        try {
            await fn({ lastFrame, frame, stdin, tmpFile, readFile, typeAndSubmit, waitFor: (pred, label) => waitFor(lastFrame, pred, label) });
        } finally {
            inkCleanup();
        }
    };

    try {
        if (fetchMock) {
            const original = global.fetch;
            global.fetch = fetchMock;
            try { await run(); } finally { global.fetch = original; }
        } else {
            await run();
        }
    } finally {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test('App: initial render shows existing messages and pending speaker', async () => {
    await withApp(null, async ({ frame }) => {
        assert.ok(frame().includes('@Bilinda'), 'Should show Bilinda header');
        assert.ok(frame().includes('Hello'), 'Should show Bilinda content');
        assert.ok(frame().includes('@Tom'), 'Should show pending Tom header');
    });
});

test('App: submit sends API call and displays response', async () => {
    await withApp({ fetch: async () => streamingResponse(['Nice to meet you, Tom!']) },
        async ({ frame, typeAndSubmit, waitFor, readFile }) => {
            await typeAndSubmit('Hey there!');
            await waitFor(f => f.includes('Nice to meet you'));

            assert.ok(frame().includes('Nice to meet you'), 'API response should appear');
            const saved = readFile();
            assert.ok(saved.includes('Hey there!'), 'User message saved');
            assert.ok(saved.includes('Nice to meet you'), 'API response saved');
        });
});

test('App: API error shows banner, preserves conversation, and restores file', async () => {
    await withApp({ fetch: async () => errorResponse(500, 'Internal Server Error') },
        async ({ frame, typeAndSubmit, waitFor, readFile }) => {
            await typeAndSubmit('Hey there!');
            await waitFor(f => f.includes('Error:'));

            assert.ok(frame().includes('Error:'), 'Error banner should appear');
            assert.ok(frame().includes('500'), 'Should mention status code');
            assert.ok(frame().includes('@Bilinda'), 'Original messages should remain');
            assert.ok(!readFile().includes('Internal Server Error'), 'API error should not be in file');
        });
});

test('App: API error prefills input for retry', async () => {
    await withApp({ fetch: async () => errorResponse(500, 'Server Error') },
        async ({ frame, typeAndSubmit, waitFor }) => {
            await typeAndSubmit('my important message');
            await waitFor(f => f.includes('Error:'));
            assert.ok(frame().includes('my important message'), 'Failed input should be prefilled');
        });
});

test('App: escape saves file and exits', async () => {
    await withApp(null, async ({ stdin, readFile }) => {
        stdin.write('\x1b');
        await tick(150); // ink needs time to distinguish standalone Esc from sequences
        const saved = readFile();
        assert.ok(saved.includes('Bilinda'), 'File should contain original messages');
        assert.ok(saved.includes('Hello'), 'File should contain message content');
    });
});

test('App: multi-chunk streaming accumulates response', async () => {
    await withApp({ fetch: async () => streamingResponse(['Hello ', 'there ', 'Tom!']) },
        async ({ frame, typeAndSubmit, waitFor, readFile }) => {
            await typeAndSubmit('Hi');
            await waitFor(f => f.includes('Hello there Tom!'));
            assert.ok(frame().includes('Hello there Tom!'), 'All chunks accumulated');
            assert.ok(readFile().includes('Hello there Tom!'), 'Accumulated response saved');
        });
});

test('App: postCompletionLint adds next speaker after response', async () => {
    await withApp({ fetch: async () => streamingResponse(['Catch some waves!']) },
        async ({ typeAndSubmit, waitFor, readFile }) => {
            await typeAndSubmit('Teach me to surf');
            await waitFor(f => f.includes('Catch some waves!'));
            const afterResponse = readFile().slice(readFile().lastIndexOf('Catch some waves!'));
            assert.ok(afterResponse.includes('@Tom'), 'postCompletionLint should add @Tom');
        });
});

test('App: AbortError shows cancellation message', async () => {
    const abortFetch = async () => { const err = new Error('aborted'); err.name = 'AbortError'; throw err; };
    await withApp({ fetch: abortFetch }, async ({ frame, typeAndSubmit, waitFor }) => {
        await typeAndSubmit('Hello');
        await waitFor(f => f.includes('Request cancelled'));
        assert.ok(frame().includes('Request cancelled'), 'Should show cancellation message');
        assert.ok(!frame().includes('Error:'), 'Should not show Error: prefix');
    });
});

test('App: mid-stream API failure restores state and prefills input', async () => {
    const fetch = async () => streamingResponse(['partial response'], { throwAfter: new Error('Connection reset') });
    await withApp({ fetch }, async ({ frame, typeAndSubmit, waitFor, readFile }) => {
        await typeAndSubmit('my message');
        await waitFor(f => f.includes('Connection reset'));

        assert.ok(frame().includes('Error:'), 'Error banner should appear');
        assert.ok(frame().includes('@Bilinda'), 'Original messages should remain');
        assert.ok(frame().includes('my message'), 'Failed input should be prefilled');
        assert.ok(!readFile().includes('partial response'), 'Partial content should not be saved');
    });
});

test('App: writeFileSync failure on save shows error and preserves state', async () => {
    await withApp({ fetch: async () => streamingResponse(['Great response!']) },
        async ({ frame, typeAndSubmit, waitFor, tmpFile }) => {
            const origWriteFileSync = fs.writeFileSync;
            let callCount = 0;
            let failed = false;
            fs.writeFileSync = function(...args) {
                callCount++;
                if (callCount === 2 && !failed && String(args[0]) === tmpFile) {
                    failed = true;
                    throw new Error('EACCES: permission denied');
                }
                return origWriteFileSync.apply(this, args);
            };
            try {
                await typeAndSubmit('Hello');
                await waitFor(f => f.includes('EACCES'));
                assert.ok(frame().includes('EACCES'), 'Should show write error');
            } finally {
                fs.writeFileSync = origWriteFileSync;
            }
        });
});

test('App: /exit command saves and exits', async () => {
    await withApp(null, async ({ typeAndSubmit, readFile }) => {
        await typeAndSubmit('/exit');
        await tick(50);
        const saved = readFile();
        assert.ok(saved.includes('Bilinda'), 'File should be saved before exit');
        assert.ok(saved.includes('Hello'), 'File should contain message content');
    });
});

test('App: /regenerate re-requests last assistant message', async () => {
    let fetchCount = 0;
    const fetch = async () => { fetchCount++; return streamingResponse([fetchCount === 1 ? 'First response' : 'Regenerated response']); };
    await withApp({ fetch }, async ({ frame, typeAndSubmit, waitFor, readFile }) => {
        await typeAndSubmit('Hi');
        await waitFor(f => f.includes('First response'), 'first response');

        await typeAndSubmit('/regenerate');
        await waitFor(f => f.includes('Regenerated response'), 'regenerated response');

        assert.ok(frame().includes('Regenerated response'), 'Regenerated response should appear');
        const saved = readFile();
        assert.ok(saved.includes('Regenerated response'), 'Regenerated response saved');
        assert.ok(!saved.includes('First response'), 'Original response removed');
    });
});

test('App: multi-turn conversation works correctly', async () => {
    let fetchCount = 0;
    const fetch = async () => { fetchCount++; return streamingResponse([fetchCount === 1 ? 'Reply one' : 'Reply two']); };
    await withApp({ fetch }, async ({ frame, typeAndSubmit, waitFor, readFile }) => {
        await typeAndSubmit('Message one');
        await waitFor(f => f.includes('Reply one'), 'first reply');

        await typeAndSubmit('Message two');
        await waitFor(f => f.includes('Reply two'), 'second reply');

        assert.ok(frame().includes('Reply one'), 'First reply visible');
        assert.ok(frame().includes('Reply two'), 'Second reply visible');
        const saved = readFile();
        assert.ok(saved.includes('Message one') && saved.includes('Reply one'), 'First turn saved');
        assert.ok(saved.includes('Message two') && saved.includes('Reply two'), 'Second turn saved');
        assert.strictEqual(fetchCount, 2, 'Exactly 2 API calls');
    });
});

test('App: streaming content is visible before completion', async () => {
    let resolveSecondChunk;
    const waitPromise = new Promise(r => { resolveSecondChunk = r; });
    const fetch = async () => streamingResponse(['partial content visible', { wait: waitPromise }]);
    await withApp({ fetch }, async ({ frame, typeAndSubmit, waitFor }) => {
        await typeAndSubmit('Hi');
        await waitFor(f => f.includes('partial content visible'), 'streaming partial');
        assert.ok(frame().includes('partial content visible'), 'Partial content visible before completion');
        resolveSecondChunk();
        await tick(50);
    });
});

test('App: unknown slash command is submitted as regular text', async () => {
    await withApp({ fetch: async () => streamingResponse(['Got it!']) },
        async ({ typeAndSubmit, waitFor, readFile }) => {
            await typeAndSubmit('/foo');
            await waitFor(f => f.includes('Got it!'), 'response to unknown command');
            const saved = readFile();
            assert.ok(saved.includes('/foo'), 'Unknown command submitted as text');
            assert.ok(saved.includes('Got it!'), 'API response saved');
        });
});

test('App: escape during busy state is ignored', async () => {
    const fetch = async () => streamingResponse(['streaming...', { delay: 50 }]);
    await withApp({ fetch }, async ({ stdin, waitFor, readFile }) => {
        stdin.write('Hi'); await tick(); stdin.write('\r');
        await waitFor(f => f.includes('streaming'));

        stdin.write('\x1b');
        await tick(150);
        await waitFor(f => !f.includes('Sending'));
        await tick();

        assert.ok(readFile().includes('streaming'), 'Escape during busy should not exit');
    });
});

// ─── Edge-case .pqueen file loading tests ────────────────────────────────────

test('App: simple prompt with standard role names (user/assistant)', async () => {
    const content = testContent('@system\nYou are helpful.\n\n@user\n');
    await withApp({ content, fetch: async () => streamingResponse(['I can help!']) },
        async ({ frame, typeAndSubmit, waitFor, readFile }) => {
            assert.ok(frame().includes('@user'), 'Pending @user visible');

            await typeAndSubmit('Hello');
            await waitFor(f => f.includes('I can help!'), 'response');

            const saved = readFile();
            assert.ok(saved.includes('Hello') && saved.includes('I can help!'), 'Turn saved');
            assert.ok(saved.trimEnd().endsWith('@user'), 'File ends with pending @user');
        });
});

test('App: system-only file (no user message) shows last message as prefill', async () => {
    const content = testContent('@system\nYou are helpful.');
    await withApp(content, async ({ frame }) => {
        assert.ok(frame().includes('You are helpful'), 'System message content should be prefilled');
    });
});

test('App: mid-conversation file with all messages filled triggers prefill', async () => {
    const content = `---\n${SELF_CONTAINED_CONFIG}\nroleplay_user: Tom\n---\n@Bilinda\nHello!\n\n@Tom\nHi there!\n\n@Bilinda\nHow are you?`;
    await withApp(content, async ({ frame }) => {
        assert.ok(frame().includes('How are you?'), 'Last message prefilled for editing');
        assert.ok(frame().includes('Hello!'), 'Earlier messages visible');
        assert.ok(frame().includes('Hi there!'), 'Tom message visible');
    });
});

test('App: file with no messages (frontmatter only) renders without crash', async () => {
    await withApp(testContent(''), async ({ frame }) => {
        assert.ok(frame().includes('Enter send') || frame().includes('quit'), 'Status hint visible');
    });
});

test('App: file with single @user message and no system prompt', async () => {
    const content = testContent('@user\n');
    await withApp({ content, fetch: async () => streamingResponse(['Hi there!']) },
        async ({ frame, typeAndSubmit, waitFor, readFile }) => {
            assert.ok(frame().includes('@user'), 'Pending @user visible');
            await typeAndSubmit('Hello world');
            await waitFor(f => f.includes('Hi there!'), 'response');
            const saved = readFile();
            assert.ok(saved.includes('Hello world') && saved.includes('Hi there!'), 'Turn saved');
        });
});

test('App: file with assistant as last message creates pending user turn', async () => {
    const content = testContent('@system\nBe helpful.\n\n@user\nHello!\n\n@assistant\n');
    await withApp(content, async ({ frame, typeAndSubmit, waitFor, readFile }) => {
        assert.ok(frame().includes('@assistant'), 'Pending @assistant visible');
        assert.ok(frame().includes('Hello!'), 'User message visible');

        await typeAndSubmit('I am here to help.');
        await waitFor(f => f.includes('@user') && f.includes('I am here to help.'), 'pending user after assistant fill');

        const saved = readFile();
        assert.ok(saved.includes('I am here to help.'), 'Assistant content saved');
        assert.ok(saved.trimEnd().endsWith('@user'), 'File ends with pending @user');
    });
});

test('App: multi-turn with standard roles preserves correct file structure', async () => {
    const content = testContent('@system\nYou are helpful.\n\n@user\n');
    let fetchCount = 0;
    const fetch = async () => { fetchCount++; return streamingResponse([`Reply ${fetchCount}`]); };
    await withApp({ content, fetch }, async ({ typeAndSubmit, waitFor, readFile }) => {
        await typeAndSubmit('First message');
        await waitFor(f => f.includes('Reply 1'), 'first reply');

        await typeAndSubmit('Second message');
        await waitFor(f => f.includes('Reply 2'), 'second reply');

        const saved = readFile();
        assert.ok(saved.includes('First message') && saved.includes('Reply 1'), 'First turn saved');
        assert.ok(saved.includes('Second message') && saved.includes('Reply 2'), 'Second turn saved');
        assert.ok(saved.trimEnd().endsWith('@user'), 'File ends with pending @user');
    });
});

test('App: file with decorators on messages renders correctly', async () => {
    const content = `---\n${SELF_CONTAINED_CONFIG}\nroleplay_user: Tom\n---\n@Bilinda [happy]\nHello!\n\n@Tom\n`;
    await withApp(content, async ({ frame }) => {
        assert.ok(frame().includes('Hello!'), 'Decorated message content visible');
        assert.ok(frame().includes('@Tom'), 'Pending Tom visible');
    });
});

test('App: save roundtrip preserves file structure', async () => {
    const content = testContent('@system\nBe helpful.\n\n@user\n');
    await withApp(content, async ({ typeAndSubmit, readFile }) => {
        await typeAndSubmit('/exit');
        await tick(50);
        const saved = readFile();
        assert.ok(saved.startsWith('---\n'), 'Starts with frontmatter');
        assert.ok(saved.includes('connection: test'), 'Connection preserved');
        assert.ok(saved.includes('@system') && saved.includes('Be helpful'), 'System message preserved');
        assert.ok(saved.includes('@user'), 'User marker preserved');

        const doc = pqutils.parseConfigAndMessages(saved);
        assert.ok(doc.messages.length >= 2, 'Re-parsed file has at least 2 messages');
    });
});

// ─── Response speaker tests ─────────────────────────────────────────────────

test('App: pending line shows guessed response speaker', async () => {
    await withApp(null, async ({ frame }) => {
        assert.ok(frame().includes('@Tom'), 'Should show pending speaker');
        assert.ok(frame().includes('>Bilinda'), 'Should show guessed response speaker');
    });
});

test('App: changing speaker via @ recalculates response speaker', async () => {
    await withApp(null, async ({ typeAndSubmit, waitFor, frame }) => {
        await typeAndSubmit('@Bilinda');
        await waitFor(f => f.includes('@Bilinda') && f.includes('>Tom'), 'pending shows @Bilinda >Tom');
        assert.ok(frame().includes('@Bilinda'), 'Speaker should be Bilinda');
        assert.ok(frame().includes('>Tom'), 'Response speaker should recalculate to Tom');
    });
});

test('App: > input overrides response speaker', async () => {
    const content = `---
connection: test
connection_profiles:
  test:
    api_url: http://dummy
dot_config_loading: false
roleplay_user: Tom
---
@system
You are a group chat.

@Bilinda
Hello!

@Charlie
Hi there!

@Tom
`;
    await withApp(content, async ({ typeAndSubmit, waitFor, frame }) => {
        await typeAndSubmit('>Charlie');
        await waitFor(f => f.includes('>Charlie'), 'pending shows >Charlie');
        assert.ok(frame().includes('>Charlie'), 'Response speaker overridden to Charlie');
    });
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
