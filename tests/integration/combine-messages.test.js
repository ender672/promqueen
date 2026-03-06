const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { combineAdjacentMessages } = require('../../combine-messages.js');

const fixturesDir = path.join(__dirname, '../fixtures/combine-messages');

const files = fs.readdirSync(fixturesDir);
const inputFiles = files.filter(f => f.endsWith('.input.json'));

inputFiles.forEach(inputFile => {
  const testName = inputFile.replace('.input.json', '');
  const outputFile = inputFile.replace('.input.json', '.output.json');

  test(`combine-messages processes ${testName}`, () => {
    const input = JSON.parse(fs.readFileSync(path.join(fixturesDir, inputFile), 'utf8'));
    const expected = JSON.parse(fs.readFileSync(path.join(fixturesDir, outputFile), 'utf8'));

    const result = combineAdjacentMessages(input);
    assert.deepStrictEqual(result, expected);
  });
});
