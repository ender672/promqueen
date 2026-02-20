const { test } = require('node:test');
const assert = require('node:assert');
const { createChatmlPrompt } = require('../../charcard-png-to-txt.js');

test('createChatmlPrompt assembles description, personality, and scenario', () => {
    const result = createChatmlPrompt({
        name: 'Luna',
        description: 'A mysterious sorceress',
        personality: 'Wise and enigmatic',
        scenario: 'A dark forest at midnight',
    });

    assert.strictEqual(
        result,
        'A mysterious sorceress\nWise and enigmatic\nScenario: A dark forest at midnight'
    );
});

test('createChatmlPrompt parses mes_example with <START> delimiters', () => {
    const result = createChatmlPrompt({
        name: 'Luna',
        description: 'A sorceress',
        mes_example: '<START>\nHello traveler\n<START>\nWelcome to my tower',
    });

    assert.strictEqual(
        result,
        'A sorceress\n\nEXAMPLE MESSAGES:\n\nLuna: Hello traveler\n\nLuna: Welcome to my tower'
    );
});
