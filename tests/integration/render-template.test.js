const { test } = require('node:test');
const assert = require('node:assert');
const { expandCBS } = require('../../lib/render-template.js');

test('expandCBS resolves dot-notation variable paths', () => {
  const template = 'Hello {{ user.name }}, your role is {{ user.settings.role }}.';
  const context = {
    user: {
      name: 'Alice',
      settings: {
        role: 'admin'
      }
    }
  };

  const result = expandCBS(template, context);
  assert.strictEqual(result, 'Hello Alice, your role is admin.');
});

test('expandCBS random trims whitespace from options', () => {
  const template = 'Hi, {{random: Harry, Dick, Tom}}';
  const context = {};
  const result = expandCBS(template, context);
  assert.ok(
    ['Hi, Harry', 'Hi, Dick', 'Hi, Tom'].includes(result),
    `expected trimmed result, got: "${result}"`
  );
});

test('expandCBS pick trims whitespace from options', () => {
  const template = '{{pick: alpha , beta , gamma }}';
  const context = {};
  const result = expandCBS(template, context, 'seed');
  assert.ok(
    ['alpha', 'beta', 'gamma'].includes(result),
    `expected trimmed result, got: "${result}"`
  );
});

test('expandCBS leaves unrecognized macros intact', () => {
  const template = 'Value: {{ a.b.c }}';
  const context = { a: { x: 1 } };

  const result = expandCBS(template, context);
  assert.strictEqual(result, 'Value: {{ a.b.c }}');
});
