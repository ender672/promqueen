const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { applyTemplate } = require('../../applytemplate.js');

const fixturesDir = path.join(__dirname, '../fixtures/applytemplate/security');
const allowedDir = path.join(fixturesDir, 'allowed');

class StringStream {
  constructor() {
    this.data = '';
  }
  write(chunk) {
    this.data += chunk.toString();
  }
}

test('applytemplate prevents directory traversal in include', async (t) => {
  const exploitPromptPath = path.join(allowedDir, 'exploit.prompt');
  const promptText = fs.readFileSync(exploitPromptPath, 'utf8');
  const outputStream = new StringStream();

  const options = {
    message_template_loader_path: allowedDir
  };

  try {
    await applyTemplate(promptText, options, outputStream);

    // If it doesn't throw, check if the secret leaked
    if (outputStream.data.includes('SECRET_DATA')) {
      assert.fail('Security vulnerability: ../forbidden.txt was included!');
    } else {
      // It might have just failed to find it silently or rendered empty? 
      // Nunjucks usually throws if include fails unless ignoreMissing is true.
      // But let's see what happens.
    }
  } catch (err) {
    // If it throws an error related to path traversal or file not found, that's good.
    // Nunjucks FileSystemLoader protects against this by default.
    // It usually says "template not found" because it resolves the path, checks if it's within root, 
    // and if not, claims it's not found.
    assert.ok(err.message.includes('not found') || err.message.includes('illegal'),
      `Expected error to be about missing file or illegal path, got: ${err.message}`);
  }
});
