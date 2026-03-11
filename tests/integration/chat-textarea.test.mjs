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

test('TextArea: Ctrl+D submits trimmed text', async () => {
    const { stdin, getSubmitted } = renderTextArea();
    stdin.write('hello world');
    await tick();
    stdin.write('\x04'); // Ctrl+D
    await tick();
    assert.strictEqual(getSubmitted(), 'hello world');
});

test('TextArea: Ctrl+D on empty input does not submit', async () => {
    const { stdin, getSubmitted } = renderTextArea();
    stdin.write('\x04');
    await tick();
    assert.strictEqual(getSubmitted(), null, 'Empty input should not submit');
});

test('TextArea: Enter adds a newline', async () => {
    const { stdin, getFrame } = renderTextArea();
    stdin.write('line1');
    await tick();
    stdin.write('\r'); // Enter
    await tick();
    stdin.write('line2');
    await tick();
    const frame = getFrame();
    assert.ok(frame.includes('line1'), 'First line should appear');
    assert.ok(frame.includes('line2'), 'Second line should appear');
});

test('TextArea: Ctrl+D submits multi-line text', async () => {
    const { stdin, getSubmitted } = renderTextArea();
    stdin.write('line1');
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('line2');
    await tick();
    stdin.write('\x04');
    await tick();
    assert.strictEqual(getSubmitted(), 'line1\nline2');
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
    stdin.write('\x04');
    await tick();
    assert.strictEqual(getSubmitted(), 'aXbY');
});

test('TextArea: vertical arrow keys navigate lines with column clamping', async () => {
    const { stdin, getSubmitted } = renderTextArea();
    stdin.write('ab');       // short line
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('cdefg');    // long line, cursor at col 5
    await tick();
    stdin.write('\x1b[A');   // up — col clamps from 5 to 2
    await tick();
    stdin.write('X');        // insert at col 2 of line 1
    await tick();
    stdin.write('\x1b[B');   // down — back to line 2, col restored to clamped position
    await tick();
    stdin.write('Y');        // insert at clamped col on line 2
    await tick();
    stdin.write('\x04');
    await tick();
    assert.strictEqual(getSubmitted(), 'abX\ncdeYfg');
});

test('TextArea: backspace at line start joins with previous line', async () => {
    const { stdin, getSubmitted } = renderTextArea();
    stdin.write('abc');
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('def');
    await tick();
    // Move to start of line 2
    stdin.write('\x1b[D');
    await tick();
    stdin.write('\x1b[D');
    await tick();
    stdin.write('\x1b[D');
    await tick();
    // Backspace joins lines
    stdin.write('\x7f');
    await tick();
    stdin.write('\x04');
    await tick();
    assert.strictEqual(getSubmitted(), 'abcdef');
});

test('TextArea: Ctrl+D after submit clears the buffer', async () => {
    const { stdin, getFrame } = renderTextArea();
    stdin.write('first');
    await tick();
    stdin.write('\x04');
    await tick();
    const frame = getFrame();
    assert.ok(!frame.includes('first'), 'Buffer should be cleared after submit');
});
