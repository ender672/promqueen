const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { applyLorebook, resolveLorebookPath } = require('../../apply-lorebook.js');
const { parseConfigAndMessages, serializeDocument, resolveConfig } = require('../../lib/pq-utils.js');

const fixturesDir = path.join(__dirname, '../fixtures/apply-lorebook');

// Find all input files
const files = fs.readdirSync(fixturesDir);
const inputFiles = files.filter(f => f.endsWith('.input.pqueen'));

inputFiles.forEach(inputFile => {
  const testName = inputFile.replace('.input.pqueen', '');
  const lorebookFile = inputFile.replace('.input.pqueen', '.lorebook.json');
  const expectedOutputFile = inputFile.replace('.input.pqueen', '.output.pqueen');

  test(`apply-lorebook - ${testName}`, async () => {
    const inputPath = path.join(fixturesDir, inputFile);
    const lorebookPath = path.join(fixturesDir, lorebookFile);
    const outputPath = path.join(fixturesDir, expectedOutputFile);

    if (!fs.existsSync(lorebookPath)) {
      throw new Error(`Expected lorebook file not found: ${lorebookPath}`);
    }

    if (!fs.existsSync(outputPath)) {
      throw new Error(`Expected output file not found: ${outputPath}`);
    }

    const prompt = fs.readFileSync(inputPath, 'utf8');
    const { config, messages } = parseConfigAndMessages(prompt);
    const resolved = resolveConfig(config);
    const lorebook = JSON.parse(fs.readFileSync(lorebookPath, 'utf8'));

    const resultMessages = applyLorebook(messages, resolved, lorebook);
    const output = serializeDocument(config, resultMessages);
    const expectedOutput = fs.readFileSync(outputPath, 'utf8');

    assert.strictEqual(output, expectedOutput, `Output for ${testName} should match expected output`);
  });
});

test('apply-lorebook - resolveLorebookPath extracts lorebook from frontmatter config', async () => {
  const inputPath = path.join(fixturesDir, 'config_lorebook_path.input.pqueen');
  const promptText = fs.readFileSync(inputPath, 'utf8');
  const { config, messages } = parseConfigAndMessages(promptText);
  const resolved = resolveConfig(config);

  const lorebookPath = resolveLorebookPath(resolved);
  assert.strictEqual(lorebookPath, 'tests/fixtures/apply-lorebook/config_lorebook_path.lorebook.json');

  const lorebook = JSON.parse(fs.readFileSync(lorebookPath, 'utf8'));
  const resultMessages = applyLorebook(messages, resolved, lorebook);
  const output = serializeDocument(config, resultMessages);

  const expectedOutputPath = path.join(fixturesDir, 'config_lorebook_path.output.pqueen');
  const expectedOutput = fs.readFileSync(expectedOutputPath, 'utf8');
  assert.strictEqual(output, expectedOutput);
});

test('apply-lorebook - resolveLorebookPath returns undefined when no lorebook in config', async () => {
  const inputPath = path.join(fixturesDir, 'basic_match.input.pqueen');
  const promptText = fs.readFileSync(inputPath, 'utf8');
  const { config } = parseConfigAndMessages(promptText);
  const resolved = resolveConfig(config);

  const lorebookPath = resolveLorebookPath(resolved);
  assert.strictEqual(lorebookPath, undefined);
});
