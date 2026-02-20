const { test } = require('node:test');
const assert = require('node:assert');
const { getCardField } = require('../../charcard-png-get-field.js');

test('getCardField returns JSON.stringify for object values', () => {
    const cardData = {
        name: 'TestChar',
        extensions: { depth: 4, role: 'system' },
    };

    const result = getCardField(cardData, 'extensions');

    assert.strictEqual(result, JSON.stringify({ depth: 4, role: 'system' }, null, 2));
});

test('getCardField returns String for string values', () => {
    const cardData = {
        name: 'TestChar',
        description: 'A brave warrior',
    };

    const result = getCardField(cardData, 'description');

    assert.strictEqual(result, 'A brave warrior');
});

test('getCardField throws with available fields when field is missing', () => {
    const cardData = {
        name: 'TestChar',
        description: 'A brave warrior',
    };

    assert.throws(
        () => getCardField(cardData, 'nonexistent'),
        {
            message: "Field 'nonexistent' not found in card data. Available fields: name, description",
        }
    );
});
