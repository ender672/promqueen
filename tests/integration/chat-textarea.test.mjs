import { test } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { render } from 'ink-testing-library';
import { TextArea } from '../../chat-ink-view.mjs';

const h = React.createElement;
// eslint-disable-next-line no-control-regex
const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, '');
const tick = () => new Promise(r => setTimeout(r, 0));

function renderTextArea(props = {}) {
    let submitted = null;
    const onSubmit = (text) => { submitted = text; };
    const inst = render(h(TextArea, { onSubmit, height: 3, ...props }));
    return { ...inst, getSubmitted: () => submitted, getFrame: () => stripAnsi(inst.lastFrame()) };
}

test('TextArea: typing characters appears in frame', async () => {
    const { stdin, getFrame } = renderTextArea();
    stdin.write('h');
    await tick();
    stdin.write('ello');
    await tick();
    assert.ok(getFrame().includes('hello'), 'Typed text should appear');
});

test('TextArea: Enter submits trimmed text', async () => {
    const { stdin, getSubmitted } = renderTextArea();
    stdin.write('hello world');
    await tick();
    stdin.write('\r'); // Enter
    await tick();
    assert.strictEqual(getSubmitted(), 'hello world');
});

test('TextArea: Enter on empty input submits empty string', async () => {
    const { stdin, getSubmitted } = renderTextArea();
    stdin.write('\r');
    await tick();
    assert.strictEqual(getSubmitted(), '', 'Empty input should submit empty string');
});

test('TextArea: backspace deletes character', async () => {
    const { stdin, getFrame } = renderTextArea();
    stdin.write('helo');
    await tick();
    stdin.write('\x7f'); // backspace
    await tick();
    stdin.write('lo');
    await tick();
    assert.ok(getFrame().includes('hello'), 'Backspace + retype should produce "hello"');
});

test('TextArea: disabled ignores input', async () => {
    const { stdin, getFrame } = renderTextArea({ disabled: true });
    stdin.write('hello');
    await tick();
    const frame = getFrame();
    assert.ok(!frame.includes('hello'), 'Disabled textarea should not show typed text');
});

test('TextArea: initialText prefills the buffer', () => {
    const { getFrame } = renderTextArea({ initialText: 'prefilled' });
    assert.ok(getFrame().includes('prefilled'), 'Initial text should appear in frame');
});

test('TextArea: horizontal arrow keys move cursor for mid-line insertion', async () => {
    const { stdin, getSubmitted } = renderTextArea();
    stdin.write('ab');
    await tick();
    stdin.write('\x1b[D'); // left
    await tick();
    stdin.write('X');
    await tick();
    stdin.write('\x1b[C'); // right (past 'b')
    await tick();
    stdin.write('Y');
    await tick();
    stdin.write('\r');
    await tick();
    assert.strictEqual(getSubmitted(), 'aXbY');
});

test('TextArea: Enter after submit clears the buffer', async () => {
    const { stdin, getFrame } = renderTextArea();
    stdin.write('first');
    await tick();
    stdin.write('\r');
    await tick();
    const frame = getFrame();
    assert.ok(!frame.includes('first'), 'Buffer should be cleared after submit');
});

test('TextArea: vertical arrow keys navigate between lines', async () => {
    const { stdin, getSubmitted } = renderTextArea({
        initialText: 'line1\nline2\nline3'
    });
    // Cursor starts at end of line3 (row=2, col=5)
    // Up arrow moves to line2
    stdin.write('\x1b[A'); // up
    await tick();
    // Insert at cursor position on line2
    stdin.write('X');
    await tick();
    // Up arrow to line1
    stdin.write('\x1b[A'); // up
    await tick();
    stdin.write('Y');
    await tick();
    // Down twice to line3
    stdin.write('\x1b[B'); // down
    await tick();
    stdin.write('\x1b[B'); // down
    await tick();
    stdin.write('Z');
    await tick();
    stdin.write('\r');
    await tick();
    assert.strictEqual(getSubmitted(), 'line1Y\nline2X\nline3Z');
});

test('TextArea: backspace at start of line joins with previous line', async () => {
    const { stdin, getSubmitted } = renderTextArea({ initialText: 'ab\ncd' });
    // Cursor is at end of 'cd' (row=1, col=2)
    // Move to start of line2
    stdin.write('\x1b[D'); // left
    await tick();
    stdin.write('\x1b[D'); // left
    await tick();
    // Backspace should join lines
    stdin.write('\x7f');
    await tick();
    stdin.write('\r');
    await tick();
    assert.strictEqual(getSubmitted(), 'abcd');
});
