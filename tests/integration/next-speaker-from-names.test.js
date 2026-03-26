const { test } = require('node:test');
const assert = require('node:assert');
const { nextSpeakerFromNames } = require('../../lib/pq-utils.js');

test('nextSpeakerFromNames: empty list returns null', () => {
    assert.strictEqual(nextSpeakerFromNames([], 'user'), null);
});

test('nextSpeakerFromNames: alternation pattern returns follower', () => {
    // Alice spoke, then Bob, then Alice again — next should be Bob
    assert.strictEqual(nextSpeakerFromNames(['Alice', 'Bob', 'Alice'], 'user'), 'Bob');
});

test('nextSpeakerFromNames: standard roles alternate user/assistant', () => {
    assert.strictEqual(nextSpeakerFromNames(['user', 'assistant', 'user'], 'user'), 'assistant');
    assert.strictEqual(nextSpeakerFromNames(['user', 'assistant'], 'user'), 'user');
});

test('nextSpeakerFromNames: falls back to character name', () => {
    // Last speaker is user, find most recent character name
    assert.strictEqual(nextSpeakerFromNames(['system', 'Alice', 'user'], 'user'), 'Alice');
});

test('nextSpeakerFromNames: falls back to roleplay_user for character speaker', () => {
    // Last speaker is a character, no alternation pattern, no other characters
    assert.strictEqual(nextSpeakerFromNames(['Tom', 'Alice'], 'Tom'), 'Tom');
});

test('nextSpeakerFromNames: falls back to assistant for standard roles only', () => {
    assert.strictEqual(nextSpeakerFromNames(['user'], 'user'), 'assistant');
});

test('nextSpeakerFromNames: falls back to user when last is assistant', () => {
    assert.strictEqual(nextSpeakerFromNames(['assistant'], 'user'), 'user');
});
