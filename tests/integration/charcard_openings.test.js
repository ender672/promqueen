const { test } = require('node:test');
const assert = require('node:assert');
const { filenameSafeCharname, formatMessage, exportCharacterMessages } = require('../../charcard-png-to-openings.js');

// filenameSafeCharname tests

test('filenameSafeCharname replaces spaces with underscores', () => {
    assert.strictEqual(filenameSafeCharname('My Character'), 'My_Character');
});

test('filenameSafeCharname removes special characters', () => {
    assert.strictEqual(filenameSafeCharname('Hero!@#$%^&*()'), 'Hero');
});

test('filenameSafeCharname keeps alphanumeric, underscore, and hyphen', () => {
    assert.strictEqual(filenameSafeCharname('Cool-Bot_99'), 'Cool-Bot_99');
});

test('filenameSafeCharname returns "unnamed" for empty result after sanitization', () => {
    assert.strictEqual(filenameSafeCharname('!!!'), 'unnamed');
});

test('filenameSafeCharname returns "unnamed" for empty string', () => {
    assert.strictEqual(filenameSafeCharname(''), 'unnamed');
});

test('filenameSafeCharname returns "unnamed" for names longer than 200 characters', () => {
    const longName = 'A'.repeat(201);
    assert.strictEqual(filenameSafeCharname(longName), 'unnamed');
});

test('filenameSafeCharname keeps names exactly 200 characters', () => {
    const name = 'A'.repeat(200);
    assert.strictEqual(filenameSafeCharname(name), name);
});

// formatMessage tests

test('formatMessage replaces {{char}} placeholders with character name', () => {
    assert.strictEqual(
        formatMessage('Alice', 'Hello, I am {{char}}. Nice to meet you, says {{char}}.'),
        'Hello, I am Alice. Nice to meet you, says Alice.'
    );
});

test('formatMessage returns message unchanged when no placeholders exist', () => {
    assert.strictEqual(
        formatMessage('Alice', 'Hello, world!'),
        'Hello, world!'
    );
});

// exportCharacterMessages tests

test('exportCharacterMessages with first message only', () => {
    const results = exportCharacterMessages({
        name: 'Luna',
        first_mes: 'Greetings, traveler.',
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].filename, 'Luna-first-message.txt');
    assert.strictEqual(results[0].content, 'Greetings, traveler.');
});

test('exportCharacterMessages with alternate greetings', () => {
    const results = exportCharacterMessages({
        name: 'Luna',
        first_mes: 'Hello!',
        alternate_greetings: ['Hi there!', 'Welcome, {{char}} greets you.'],
    });

    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0].filename, 'Luna-first-message.txt');
    assert.strictEqual(results[0].content, 'Hello!');
    assert.strictEqual(results[1].filename, 'Luna-alternate-greeting-1.txt');
    assert.strictEqual(results[1].content, 'Hi there!');
    assert.strictEqual(results[2].filename, 'Luna-alternate-greeting-2.txt');
    assert.strictEqual(results[2].content, 'Welcome, Luna greets you.');
});

test('exportCharacterMessages falls back to "Character" when name is missing', () => {
    const results = exportCharacterMessages({
        first_mes: 'Hello from {{char}}.',
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].filename, 'Character-first-message.txt');
    assert.strictEqual(results[0].content, 'Hello from Character.');
});

test('exportCharacterMessages returns empty array when no first_mes or greetings', () => {
    const results = exportCharacterMessages({ name: 'Luna' });

    assert.strictEqual(results.length, 0);
});
