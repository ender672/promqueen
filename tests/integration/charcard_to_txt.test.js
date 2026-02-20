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

test('createChatmlPrompt with missing optional fields', () => {
    // Only description, no personality, no scenario, no mes_example
    const descOnly = createChatmlPrompt({
        name: 'Luna',
        description: 'A sorceress',
    });
    assert.strictEqual(descOnly, 'A sorceress');

    // No personality
    const noPersonality = createChatmlPrompt({
        name: 'Luna',
        description: 'A sorceress',
        scenario: 'A dark forest',
    });
    assert.strictEqual(noPersonality, 'A sorceress\nScenario: A dark forest');

    // No scenario
    const noScenario = createChatmlPrompt({
        name: 'Luna',
        description: 'A sorceress',
        personality: 'Wise',
    });
    assert.strictEqual(noScenario, 'A sorceress\nWise');

    // No description
    const noDescription = createChatmlPrompt({
        name: 'Luna',
        personality: 'Wise',
        scenario: 'A dark forest',
    });
    assert.strictEqual(noDescription, 'Wise\nScenario: A dark forest');

    // All optional fields missing — only name provided
    const nameOnly = createChatmlPrompt({ name: 'Luna' });
    assert.strictEqual(nameOnly, '');

    // Empty object — name defaults to 'Character'
    const empty = createChatmlPrompt({});
    assert.strictEqual(empty, '');
});
