const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { renderTemplate } = require('../../lib/rendertemplate.js');

const fixturesDir = path.join(__dirname, '../fixtures/applytemplate');

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
