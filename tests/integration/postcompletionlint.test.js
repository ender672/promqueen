const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('fs');
const { postCompletionLint } = require('../../postcompletionlint.js');

const fixturesDir = path.resolve(__dirname, '../fixtures/postcompletionlint');

// Find all input files
const files = fs.readdirSync(fixturesDir);
const inputFiles = files.filter(f => f.endsWith('.input.pqueen'));

inputFiles.forEach(inputFile => {
    const testName = inputFile.replace('.input.pqueen', '').replace(/_/g, ' ');
    const expectedOutputFile = inputFile.replace('.input.pqueen', '.output.pqueen');

    test(`postcompletionlint ${testName}`, async () => {
        const inputPath = path.join(fixturesDir, inputFile);
        const outputPath = path.join(fixturesDir, expectedOutputFile);

        if (!fs.existsSync(outputPath)) {
            throw new Error(`Expected output file not found: ${outputPath}`);
        }

        const input = fs.readFileSync(inputPath, 'utf8');
        const baseDir = path.resolve(__dirname, '../..');
        const output = postCompletionLint(input, baseDir); // Expecting refactored signature
        const expectedOutput = fs.readFileSync(outputPath, 'utf8');

        assert.strictEqual(output, expectedOutput, `Output for ${testName} should match expected output`);
    });
});
