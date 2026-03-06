const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { formatNames } = require('../../formatnames.js');
const fs = require('fs');
const yaml = require('js-yaml');
const { parseConfigAndMessages, resolveConfig } = require('../../lib/pqutils.js');

const fixturesDir = path.join(__dirname, '../fixtures/formatnames');

function serializeOutput(runtimeConfig, messages) {
  let output = '---\n';
  output += yaml.dump(runtimeConfig);
  output += '---\n';
  output += messages.map((message, index) => {
    const prefix = index > 0 ? '\n\n' : '';
    return `${prefix}@${message.role}\n${message.content}`;
  }).join('');
  return output;
}

// Find all input files
const files = fs.readdirSync(fixturesDir);
const inputFiles = files.filter(f => f.endsWith('.input.pqueen'));

inputFiles.forEach(inputFile => {
  const testName = inputFile.replace('.input.pqueen', '');
  const expectedOutputFile = inputFile.replace('.input.pqueen', '.output.pqueen');

  test(`formatnames processes ${testName}`, async () => {
    const inputPath = path.join(fixturesDir, inputFile);
    const outputPath = path.join(fixturesDir, expectedOutputFile);

    if (!fs.existsSync(outputPath)) {
      throw new Error(`Expected output file not found: ${outputPath}`);
    }

    const prompt = fs.readFileSync(inputPath, 'utf8');
    const { config, messages } = parseConfigAndMessages(prompt);
    const resolved = resolveConfig(config, fixturesDir);

    const resultMessages = formatNames(messages, resolved);
    const output = serializeOutput(config, resultMessages);
    const expectedOutput = fs.readFileSync(outputPath, 'utf8');

    assert.strictEqual(output, expectedOutput, `Output for ${testName} should match expected output`);
  });
});
