const { test } = require('node:test');
const assert = require('node:assert');
const { renderCharcardTemplate } = require('../../charcard-png-to-txt.js');

test('renderCharcardTemplate assembles description, personality, and scenario', () => {
    const result = renderCharcardTemplate({
        name: 'Luna',
        description: 'A mysterious sorceress',
        personality: 'Wise and enigmatic',
        scenario: 'A dark forest at midnight',
    });

    assert.strictEqual(
        result,
        "## Luna's Description\nA mysterious sorceress\nWise and enigmatic\n\n### Scenario\nA dark forest at midnight"
    );
});

test('renderCharcardTemplate parses mes_example with <START> delimiters', () => {
    const result = renderCharcardTemplate({
        name: 'Luna',
        description: 'A sorceress',
        mes_example: '<START>\nHello traveler\n<START>\nWelcome to my tower',
    });

    assert.strictEqual(
        result,
        "## Luna's Description\nA sorceress\n\n### Example Messages\nHello traveler\nWelcome to my tower"
    );
});

test('renderCharcardTemplate with missing optional fields', () => {
    // Only description, no personality, no scenario, no mes_example
    const descOnly = renderCharcardTemplate({
        name: 'Luna',
        description: 'A sorceress',
    });
    assert.strictEqual(descOnly, "## Luna's Description\nA sorceress");

    // No personality
    const noPersonality = renderCharcardTemplate({
        name: 'Luna',
        description: 'A sorceress',
        scenario: 'A dark forest',
    });
    assert.strictEqual(noPersonality, "## Luna's Description\nA sorceress\n\n### Scenario\nA dark forest");

    // No scenario
    const noScenario = renderCharcardTemplate({
        name: 'Luna',
        description: 'A sorceress',
        personality: 'Wise',
    });
    assert.strictEqual(noScenario, "## Luna's Description\nA sorceress\nWise");

    // No description
    const noDescription = renderCharcardTemplate({
        name: 'Luna',
        personality: 'Wise',
        scenario: 'A dark forest',
    });
    assert.strictEqual(noDescription, "## Luna's Description\nWise\n\n### Scenario\nA dark forest");

    // All optional fields missing — only name provided
    const nameOnly = renderCharcardTemplate({ name: 'Luna' });
    assert.strictEqual(nameOnly, "## Luna's Description");

    // Empty object — name defaults to 'Character'
    const empty = renderCharcardTemplate({});
    assert.strictEqual(empty, "## Character's Description");
});

test('renderCharcardTemplate replaces {{char}} in the final output', () => {
    const result = renderCharcardTemplate({
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

test('renderCharcardTemplate passes all charcard fields to template', () => {
    const { buildTemplateView } = require('../../charcard-png-to-txt.js');
    const view = buildTemplateView({
        name: 'Luna',
        description: 'A sorceress',
        personality: 'Wise',
        scenario: 'A forest',
        first_mes: 'Hello there',
        creator_notes: 'Test notes',
        tags: ['fantasy', 'magic'],
    });

    assert.strictEqual(view.charcard.name, 'Luna');
    assert.strictEqual(view.charcard.description, 'A sorceress');
    assert.strictEqual(view.charcard.personality, 'Wise');
    assert.strictEqual(view.charcard.scenario, 'A forest');
    assert.strictEqual(view.charcard.first_mes, 'Hello there');
    assert.strictEqual(view.charcard.creator_notes, 'Test notes');
    assert.deepStrictEqual(view.charcard.tags, ['fantasy', 'magic']);
});
