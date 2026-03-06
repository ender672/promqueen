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
        'A sorceress\n\nEXAMPLE MESSAGES:\n\nHello traveler\n\nWelcome to my tower'
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

test('createChatmlPrompt replaces {{char}} in the final output', () => {
    const result = createChatmlPrompt({
        name: 'Luna',
        description: '{{char}} is a mysterious sorceress',
        personality: '{{char}} is wise and enigmatic',
        scenario: '{{char}} stands in a dark forest',
        mes_example: '<START>\n{{char}} waves hello',
    });

    // All {{char}} occurrences should be replaced with the name
    assert.ok(!result.includes('{{char}}'), 'should not contain {{char}} placeholder');
    assert.ok(result.includes('Luna is a mysterious sorceress'), 'description should have name substituted');
    assert.ok(result.includes('Luna is wise and enigmatic'), 'personality should have name substituted');
    assert.ok(result.includes('Luna stands in a dark forest'), 'scenario should have name substituted');
    assert.ok(result.includes('Luna waves hello'), 'mes_example should have name substituted');
});
