const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('fs');

const scriptPath = path.resolve(__dirname, '../../precompletionlint.js');
const fixturesDir = path.resolve(__dirname, '../fixtures/precompletionlint');

function runLint(content) {
  const tmpFile = path.join(fixturesDir, `tmp_${Math.random().toString(36).substring(7)}.txt`);
  fs.writeFileSync(tmpFile, content);
  try {
    const result = spawnSync('node', [scriptPath, tmpFile], { encoding: 'utf8' });
    return result.stdout;
  } finally {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  }
}

test('precompletionlint autocompletes name', (t) => {
  const input = `---
user: User
---
@Jim
Hello

@J`;
  const output = runLint(input);
  assert.strictEqual(output, 'im');
});

test('precompletionlint adds padding and guesses next speaker', (t) => {
  const input = `---
user: User
---
@Jim
Hello`;
  const output = runLint(input);
  assert.strictEqual(output, '\n\n@User\n');
});

test('precompletionlint handles empty message for assistant guess', (t) => {
  const input = `---
user: User
---
@User
Hi`;
  const output = runLint(input);
  assert.strictEqual(output, '\n\n@assistant\n');
});

test('precompletionlint autocompletes from extraNames (user)', (t) => {
  const input = `---
user: User
---
@U`;
  const output = runLint(input);
  assert.strictEqual(output, 'ser');
});

test('precompletionlint autocompletes from PROMPT_ROLES', (t) => {
  const input = `---
user: User
---
@as`;
  const output = runLint(input);
  assert.strictEqual(output, 'sistant');
});
