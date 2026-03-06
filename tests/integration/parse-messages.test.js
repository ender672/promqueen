const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { parseMessages } = require('../../lib/pq-utils.js');

const fixturesDir = path.join(__dirname, '../fixtures/parse-messages');

// Find all input files
const files = fs.readdirSync(fixturesDir);
const inputFiles = files.filter(f => f.endsWith('.input.txt'));

inputFiles.forEach(inputFile => {
  const testName = inputFile.replace('.input.txt', '');
  const outputFile = inputFile.replace('.input.txt', '.output.json');

  test(`parseMessages: ${testName}`, () => {
    const inputPath = path.join(fixturesDir, inputFile);
    const outputPath = path.join(fixturesDir, outputFile);

    if (!fs.existsSync(outputPath)) {
      throw new Error(`Output expectation file not found: ${outputPath}`);
    }

    const input = fs.readFileSync(inputPath, 'utf8');
    const expected = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

    const result = parseMessages(input);
    assert.deepStrictEqual(result, expected);
  });
});

test('parseMessages: null input returns empty array', () => {
  assert.deepStrictEqual(parseMessages(null), []);
});

test('parseMessages: undefined input returns empty array', () => {
  assert.deepStrictEqual(parseMessages(undefined), []);
});
