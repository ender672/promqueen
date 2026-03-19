const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { filterStreamContent } = require('../../lib/stream-filter.js');

const fixturesDir = path.join(__dirname, '../fixtures/stream-filter');
const inputFiles = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.input.txt'));

inputFiles.forEach(inputFile => {
    const testName = inputFile.replace('.input.txt', '');
    const outputFile = inputFile.replace('.input.txt', '.output.txt');

    test(`stream-filter: ${testName}`, () => {
        const input = fs.readFileSync(path.join(fixturesDir, inputFile), 'utf8');
        const expected = fs.readFileSync(path.join(fixturesDir, outputFile), 'utf8');
        const result = filterStreamContent(input);
        assert.strictEqual(result, expected);
    });
});
