import { test } from 'node:test';
import assert from 'node:assert';
import { splitMessages } from '../../chat-ink-view.mjs';

test('splitMessages: empty array', () => {
    const result = splitMessages([]);
    assert.deepStrictEqual(result, { completed: [], pending: null });
});

test('splitMessages: all messages have content', () => {
    const msgs = [
        { name: 'Bilinda', content: 'Hello!\n' },
        { name: 'Tom', content: 'Hi!\n' },
    ];
    const result = splitMessages(msgs);
    assert.deepStrictEqual(result.completed, msgs);
    assert.strictEqual(result.pending, null);
});

test('splitMessages: last message has null content', () => {
    const msgs = [
        { name: 'Bilinda', content: 'Hello!\n' },
        { name: 'Tom', content: null },
    ];
    const result = splitMessages(msgs);
    assert.strictEqual(result.completed.length, 1);
    assert.strictEqual(result.completed[0].name, 'Bilinda');
    assert.strictEqual(result.pending.name, 'Tom');
});

test('splitMessages: last message has empty-string content', () => {
    const msgs = [
        { name: 'Bilinda', content: 'Hello!\n' },
        { name: 'Tom', content: '' },
    ];
    const result = splitMessages(msgs);
    assert.strictEqual(result.completed.length, 1);
    assert.strictEqual(result.pending.name, 'Tom');
});

test('splitMessages: last message has whitespace-only content', () => {
    const msgs = [
        { name: 'Bilinda', content: 'Hello!\n' },
        { name: 'Tom', content: '  \n' },
    ];
    const result = splitMessages(msgs);
    assert.strictEqual(result.completed.length, 1);
    assert.strictEqual(result.pending.name, 'Tom');
});

test('splitMessages: single message with content', () => {
    const msgs = [{ name: 'Bilinda', content: 'Hello!\n' }];
    const result = splitMessages(msgs);
    assert.strictEqual(result.completed.length, 1);
    assert.strictEqual(result.pending, null);
});

test('splitMessages: single pending message', () => {
    const msgs = [{ name: 'Tom', content: null }];
    const result = splitMessages(msgs);
    assert.strictEqual(result.completed.length, 0);
    assert.strictEqual(result.pending.name, 'Tom');
});

test('splitMessages: null content in middle is treated as completed', () => {
    const msgs = [
        { name: 'Tom', content: null },
        { name: 'Bilinda', content: 'Hello!\n' },
    ];
    const result = splitMessages(msgs);
    assert.strictEqual(result.completed.length, 2,
        'Only the last message is checked — middle null-content messages are completed');
    assert.strictEqual(result.pending, null);
});
