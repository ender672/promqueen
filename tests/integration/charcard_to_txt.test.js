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
