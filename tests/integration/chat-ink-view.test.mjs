import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import React from 'react';
import { render } from 'ink-testing-library';
import { ChatView } from '../../chat-ink-view.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '../fixtures/chat-ink-view');
// eslint-disable-next-line no-control-regex
const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, '');

const propFiles = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.props.json'));

for (const propFile of propFiles) {
    const baseName = propFile.replace('.props.json', '');
    const frameFile = path.join(fixturesDir, `${baseName}.frame.txt`);
    if (!fs.existsSync(frameFile)) continue;

    test(`chat-ink-view: ${baseName}`, () => {
        const props = JSON.parse(fs.readFileSync(path.join(fixturesDir, propFile), 'utf8'));
        props.onSubmit = () => {};

        const { lastFrame, cleanup } = render(React.createElement(ChatView, props));
        const actual = stripAnsi(lastFrame());
        const expected = fs.readFileSync(frameFile, 'utf8');

        assert.strictEqual(actual, expected,
            `Frame mismatch for ${baseName}.\n` +
            `Expected:\n${JSON.stringify(expected)}\n` +
            `Got:\n${JSON.stringify(actual)}`);
        cleanup();
    });
}

// ─── Autocomplete tests ─────────────────────────────────────────────────────

const tick = () => new Promise(r => setTimeout(r, 0));

const baseProps = {
    messages: [],
    streamName: '',
    streamLines: [],
    streamPartial: '',
    pendingMsg: null,
    sentMsg: null,
    busy: false,
    connectionName: 'test',
    costInfo: '',
    staticKey: 0,
    errorBanner: '',
    initialText: '',
};

test('ChatView: typing "/" shows command autocomplete list', async () => {
    const props = { ...baseProps, onSubmit: () => {} };
    const { lastFrame, stdin, cleanup } = render(React.createElement(ChatView, props));
    await tick();

    stdin.write('/');
    await tick();
    const frame = stripAnsi(lastFrame());
    assert.ok(frame.includes('/exit'), 'Should show /exit command');
    assert.ok(frame.includes('/regenerate'), 'Should show /regenerate command');
    assert.ok(frame.includes('/show-prompt'), 'Should show /show-prompt command');
    cleanup();
});

test('ChatView: typing "/re" filters to matching commands', async () => {
    const props = { ...baseProps, onSubmit: () => {} };
    const { lastFrame, stdin, cleanup } = render(React.createElement(ChatView, props));
    await tick();

    stdin.write('/re');
    await tick();
    const frame = stripAnsi(lastFrame());
    assert.ok(frame.includes('/regenerate'), 'Should show /regenerate');
    // Check that non-matching commands don't appear in the autocomplete list
    // (the status bar always shows "/html preview" so we look for the autocomplete-specific markers)
    const lines = frame.split('\n');
    const autocompleteLines = lines.filter(l => l.includes('▸') || l.trimStart().startsWith('/'));
    const hasExit = autocompleteLines.some(l => l.includes('/exit'));
    assert.ok(!hasExit, 'Should not show /exit in autocomplete');
    cleanup();
});

test('ChatView: arrow keys navigate autocomplete selection', async () => {
    const props = { ...baseProps, onSubmit: () => {} };
    const { lastFrame, stdin, cleanup } = render(React.createElement(ChatView, props));
    await tick();

    stdin.write('/');
    await tick();

    // First item should be selected (▸ marker)
    let frame = stripAnsi(lastFrame());
    const lines = frame.split('\n');
    const firstCmd = lines.find(l => l.includes('▸'));
    assert.ok(firstCmd, 'Should have a selected command (▸ marker)');

    // Down arrow to select next
    stdin.write('\x1b[B'); // down
    await tick();
    frame = stripAnsi(lastFrame());
    const linesAfter = frame.split('\n');
    const selectedAfter = linesAfter.find(l => l.includes('▸'));
    assert.ok(selectedAfter, 'Should still have a selected command after navigation');
    assert.notStrictEqual(firstCmd, selectedAfter, 'Selection should have moved');

    cleanup();
});

test('ChatView: tab accepts selected command', async () => {
    let lastSubmit = null;
    const props = { ...baseProps, onSubmit: (t) => { lastSubmit = t; } };
    const { lastFrame, stdin, cleanup } = render(React.createElement(ChatView, props));
    await tick();

    stdin.write('/ex');
    await tick();

    // Tab should accept the selected /exit command
    stdin.write('\t');
    await tick();

    const frame = stripAnsi(lastFrame());
    assert.ok(frame.includes('/exit'), 'Tab should fill in the selected command');

    // Enter should submit it
    stdin.write('\r');
    await tick();
    assert.strictEqual(lastSubmit, '/exit', 'Should submit the accepted command');

    cleanup();
});

test('ChatView: autocomplete hidden when busy', async () => {
    const props = { ...baseProps, busy: true, onSubmit: () => {} };
    const { lastFrame, cleanup } = render(React.createElement(ChatView, props));
    await tick();

    const frame = stripAnsi(lastFrame());
    // Even if there were a "/" in the input, busy state should suppress autocomplete
    assert.ok(!frame.includes('▸'), 'No autocomplete selection marker when busy');
    cleanup();
});
