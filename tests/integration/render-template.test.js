const { test } = require('node:test');
const assert = require('node:assert');
const { renderTemplate } = require('../../lib/render-template.js');

test('renderTemplate resolves dot-notation variable paths', () => {
  const template = 'Hello {{ user.name }}, your role is {{ user.settings.role }}.';
  const context = {
    user: {
      name: 'Alice',
      settings: {
        role: 'admin'
      }
    }
  };

  const result = renderTemplate(template, context);
  assert.strictEqual(result, 'Hello Alice, your role is admin.');
});

test('renderTemplate returns empty string for missing nested path segments', () => {
  const template = 'Value: {{ a.b.c }}';
  const context = { a: { x: 1 } };

  const result = renderTemplate(template, context);
  assert.strictEqual(result, 'Value: ');
});
