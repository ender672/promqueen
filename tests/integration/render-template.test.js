const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { renderTemplate } = require('../../lib/render-template.js');

const fixturesDir = path.join(__dirname, '../fixtures/apply-template');

test('renderTemplate throws "Template not found" when included file does not exist', () => {
  const template = '{% include "nonexistent_file.txt" %}';

  assert.throws(
    () => renderTemplate(template, {}, path.join(fixturesDir, 'root'), fixturesDir),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('Template not found: nonexistent_file.txt'),
        `Expected "Template not found" error, got: ${err.message}`);
      return true;
    }
  );
});

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

  const result = renderTemplate(template, context, path.join(fixturesDir, 'root'), fixturesDir);
  assert.strictEqual(result, 'Hello Alice, your role is admin.');
});

test('renderTemplate returns empty string for missing nested path segments', () => {
  const template = 'Value: {{ a.b.c }}';
  const context = { a: { x: 1 } };

  const result = renderTemplate(template, context, path.join(fixturesDir, 'root'), fixturesDir);
  assert.strictEqual(result, 'Value: ');
});

test('renderTemplate throws when include path variable resolves to empty', () => {
  const template = '{% include missing_var %}';

  assert.throws(
    () => renderTemplate(template, {}, path.join(fixturesDir, 'root'), fixturesDir),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('Template Error: Include path variable'),
        `Expected "Template Error: Include path variable" error, got: ${err.message}`);
      assert.ok(err.message.includes('missing_var'),
        `Expected error to mention the variable name, got: ${err.message}`);
      assert.ok(err.message.includes('empty or undefined'),
        `Expected error to say "empty or undefined", got: ${err.message}`);
      return true;
    }
  );
});
