import { test } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { render } from 'ink-testing-library';
import { TextArea } from '../../chat-ink-view.mjs';

const h = React.createElement;
// eslint-disable-next-line no-control-regex
const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, '');
const tick = (ms) => new Promise(r => setTimeout(r, ms || 0));

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

// ─── History tests ──────────────────────────────────────────────────────────

test('TextArea: up arrow recalls previous submission', async () => {
    const { stdin, getSubmitted, getFrame } = renderTextArea();
    stdin.write('first');
    await tick();
    stdin.write('\r');
    await tick();
    assert.strictEqual(getSubmitted(), 'first');
    // Now press up arrow to recall
    stdin.write('\x1b[A');
    await tick();
    assert.ok(getFrame().includes('first'), 'Up arrow should recall "first"');
});

test('TextArea: up arrow cycles through multiple submissions', async () => {
    const { stdin, getFrame } = renderTextArea();
    stdin.write('aaa');
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('bbb');
    await tick();
    stdin.write('\r');
    await tick();
    // Up once → bbb
    stdin.write('\x1b[A');
    await tick();
    assert.ok(getFrame().includes('bbb'), 'First up should recall "bbb"');
    // Up again → aaa
    stdin.write('\x1b[A');
    await tick();
    assert.ok(getFrame().includes('aaa'), 'Second up should recall "aaa"');
});

test('TextArea: down arrow after up returns to newer entry then empty', async () => {
    const { stdin, getFrame, getSubmitted } = renderTextArea();
    stdin.write('aaa');
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('bbb');
    await tick();
    stdin.write('\r');
    await tick();
    // Up twice → aaa
    stdin.write('\x1b[A');
    await tick();
    stdin.write('\x1b[A');
    await tick();
    assert.ok(getFrame().includes('aaa'));
    // Down → bbb
    stdin.write('\x1b[B');
    await tick();
    assert.ok(getFrame().includes('bbb'), 'Down should go to "bbb"');
    // Down again → restore empty input
    stdin.write('\x1b[B');
    await tick();
    const frame = getFrame();
    assert.ok(!frame.includes('aaa') && !frame.includes('bbb'), 'Down past end should restore empty input');
    // Typing after restore should work from a clean buffer
    stdin.write('fresh');
    await tick();
    stdin.write('\r');
    await tick();
    assert.strictEqual(getSubmitted(), 'fresh', 'Submit after restoring empty should only contain new text');
});

test('TextArea: down arrow restores in-progress typed text', async () => {
    const { stdin, getFrame } = renderTextArea();
    stdin.write('old');
    await tick();
    stdin.write('\r');
    await tick();
    // Start typing new text
    stdin.write('new');
    await tick();
    // Up to recall "old"
    stdin.write('\x1b[A');
    await tick();
    assert.ok(getFrame().includes('old'));
    // Down to restore "new"
    stdin.write('\x1b[B');
    await tick();
    assert.ok(getFrame().includes('new'), 'Down should restore in-progress text');
});

test('TextArea: down arrow restores initialText after browsing history', async () => {
    // Simulate: prior history exists, edit box opens with initialText prefilled
    // (e.g. after /edit-last or /generate fills the editor)
    const { stdin, getFrame } = renderTextArea();
    // Build up some history
    stdin.write('first');
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('second');
    await tick();
    stdin.write('\r');
    await tick();
    // Now type what simulates the "initial" content the user is working on
    stdin.write('editing this');
    await tick();
    // Browse history
    stdin.write('\x1b[A'); // up → "second"
    await tick();
    assert.ok(getFrame().includes('second'));
    stdin.write('\x1b[A'); // up → "first"
    await tick();
    assert.ok(getFrame().includes('first'));
    // Come all the way back down
    stdin.write('\x1b[B'); // down → "second"
    await tick();
    assert.ok(getFrame().includes('second'));
    stdin.write('\x1b[B'); // down → restore "editing this"
    await tick();
    assert.ok(getFrame().includes('editing this'), 'Should restore original edit box content');
});

test('TextArea: recalled history can be submitted', async () => {
    const { stdin, getSubmitted } = renderTextArea();
    stdin.write('recalled');
    await tick();
    stdin.write('\r');
    await tick();
    // Up to recall, then submit
    stdin.write('\x1b[A');
    await tick();
    stdin.write('\r');
    await tick();
    assert.strictEqual(getSubmitted(), 'recalled');
});

test('TextArea: duplicate consecutive submissions are not added twice', async () => {
    const { stdin, getFrame } = renderTextArea();
    stdin.write('dup');
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('dup');
    await tick();
    stdin.write('\r');
    await tick();
    // Up once → dup, up again should stay on dup (only one entry)
    stdin.write('\x1b[A');
    await tick();
    assert.ok(getFrame().includes('dup'));
    stdin.write('\x1b[A');
    await tick();
    assert.ok(getFrame().includes('dup'), 'Should still show "dup" — no second entry');
});

test('TextArea: typing after recalling history exits history mode', async () => {
    const { stdin, getSubmitted } = renderTextArea();
    stdin.write('orig');
    await tick();
    stdin.write('\r');
    await tick();
    // Recall
    stdin.write('\x1b[A');
    await tick();
    // Type extra character
    stdin.write('!');
    await tick();
    stdin.write('\r');
    await tick();
    assert.strictEqual(getSubmitted(), 'orig!');
});

test('TextArea: empty submissions are not added to history', async () => {
    const { stdin, getFrame } = renderTextArea();
    // Submit empty
    stdin.write('\r');
    await tick();
    // Submit something
    stdin.write('real');
    await tick();
    stdin.write('\r');
    await tick();
    // Up should go to "real", not empty
    stdin.write('\x1b[A');
    await tick();
    assert.ok(getFrame().includes('real'));
    // Up again should stay on "real" (no empty entry before it)
    stdin.write('\x1b[A');
    await tick();
    assert.ok(getFrame().includes('real'));
});

// Wrapper that dynamically sets activeCommands based on buffer content,
// mirroring what ChatView does (only when input starts with "/").
function renderDynamicTextArea() {
    let submitted = null;
    let navCount = 0;
    const commands = [{ name: '/regen', description: '' }];
    let currentActive = null;
    const Wrapper = () => {
        const [text, setText] = React.useState('');
        const trimmed = text.trim();
        const active = trimmed.startsWith('/')
            ? commands.filter(c => c.name.startsWith(trimmed))
            : null;
        currentActive = active && active.length > 0 ? active : null;
        return h(TextArea, {
            onSubmit: (t) => { submitted = t; },
            onChange: setText,
            height: 3,
            activeCommands: currentActive,
            onCommandNav: () => { navCount++; },
            onCommandAccept: () => commands[0].name,
        });
    };
    const inst = render(h(Wrapper));
    return {
        ...inst,
        getSubmitted: () => submitted,
        getFrame: () => stripAnsi(inst.lastFrame()),
        getNavCount: () => navCount,
        resetNavCount: () => { navCount = 0; },
    };
}

// The dynamic wrapper needs onChange → setState → re-render → new props,
// which takes two event-loop turns instead of one.
const tick2 = async () => { await tick(); await tick(); };

test('TextArea: history up/down bypasses command autocomplete', async () => {
    const { stdin, getFrame, getNavCount, resetNavCount } = renderDynamicTextArea();
    // Submit a /command so it lands in history
    stdin.write('/regen');
    await tick2();
    stdin.write('\r');
    await tick2();
    resetNavCount();
    // Buffer is now empty — no activeCommands. Up recalls /regen from history.
    stdin.write('\x1b[A');
    await tick2();
    assert.ok(getFrame().includes('/regen'), 'Should recall /regen from history');
    assert.strictEqual(getNavCount(), 0, 'Should NOT trigger command nav while browsing history');
    // Down should cycle history back to empty, not command nav
    stdin.write('\x1b[B');
    await tick2();
    assert.strictEqual(getNavCount(), 0, 'Down should still cycle history, not command nav');
    // Now type a slash — exits history mode, activeCommands kicks in
    stdin.write('/re');
    await tick2();
    stdin.write('\x1b[A');
    await tick2();
    assert.strictEqual(getNavCount(), 1, 'After typing, up should trigger command nav');
});

test('TextArea: backspace after recalling history re-enables command autocomplete', async () => {
    const { stdin, getNavCount, resetNavCount } = renderDynamicTextArea();
    stdin.write('/regen');
    await tick2();
    stdin.write('\r');
    await tick2();
    resetNavCount();
    // Recall from history (buffer was empty, no activeCommands)
    stdin.write('\x1b[A');
    await tick2();
    assert.strictEqual(getNavCount(), 0);
    // Backspace exits history mode — buffer now "/rege" which matches activeCommands
    stdin.write('\x7f');
    await tick2();
    // Now up should trigger command nav
    stdin.write('\x1b[A');
    await tick2();
    assert.strictEqual(getNavCount(), 1, 'After backspace, up should trigger command nav');
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
