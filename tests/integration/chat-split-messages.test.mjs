import { test } from 'node:test';
import assert from 'node:assert';
import { splitMessages } from '../../chat-ink-view.mjs';

test('splitMessages: last message with null content becomes pending', () => {
    const msgs = [
        { name: 'Bilinda', content: 'Hello!\n' },
        { name: 'Tom', content: null },
    ];
    const result = splitMessages(msgs);
    assert.strictEqual(result.completed.length, 1);
    assert.strictEqual(result.completed[0].name, 'Bilinda');
    assert.strictEqual(result.pending.name, 'Tom');
});

test('splitMessages: whitespace-only content counts as pending', () => {
    const msgs = [
        { name: 'Bilinda', content: 'Hello!\n' },
        { name: 'Tom', content: '  \n' },
    ];
    const result = splitMessages(msgs);
    assert.strictEqual(result.completed.length, 1);
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
