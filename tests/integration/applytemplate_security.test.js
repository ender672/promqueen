const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { applyTemplate } = require('../../applytemplate.js');
const { parseConfigAndMessages, serializeDocument, resolveConfig } = require('../../lib/pqutils.js');

const fixturesDir = path.join(__dirname, '../fixtures/applytemplate/security');
const allowedDir = path.join(fixturesDir, 'allowed');

test('applytemplate prevents directory traversal in include', async () => {
  const exploitPromptPath = path.join(allowedDir, 'exploit.pqueen');
  const promptText = fs.readFileSync(exploitPromptPath, 'utf8');

  const { config, messages } = parseConfigAndMessages(promptText);
  const resolved = resolveConfig(config);
  resolved.message_template_loader_path = allowedDir;

  try {
    const resultMessages = applyTemplate(messages, resolved, {});
    const output = serializeDocument(config, resultMessages);

    // If it doesn't throw, check if the secret leaked
    if (output.includes('SECRET_DATA')) {
      assert.fail('Security vulnerability: ../forbidden.txt was included!');
    }
  } catch (err) {
    // If it throws an error related to path traversal or file not found, that's good.
    assert.ok(err.message.includes('not found') || err.message.includes('illegal'),
      `Expected error to be about missing file or illegal path, got: ${err.message}`);
  }
});
