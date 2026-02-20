const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { rpToPrompt } = require('../../rptoprompt.js');
const fs = require('fs');


const fixturesDir = path.join(__dirname, '../fixtures/rptoprompt');

// Find all input files
const files = fs.readdirSync(fixturesDir);
const inputFiles = files.filter(f => f.endsWith('.input.pqueen'));

inputFiles.forEach(inputFile => {
  const testName = inputFile.replace('.input.pqueen', '');
  const expectedOutputFile = inputFile.replace('.input.pqueen', '.output.pqueen');

  test(`rptoprompt processes ${testName}`, async () => {
    const inputPath = path.join(fixturesDir, inputFile);
    const outputPath = path.join(fixturesDir, expectedOutputFile);

    if (!fs.existsSync(outputPath)) {
      throw new Error(`Expected output file not found: ${outputPath}`);
    }

    const prompt = fs.readFileSync(inputPath, 'utf8');

    const output = await rpToPrompt(prompt);
    const expectedOutput = fs.readFileSync(outputPath, 'utf8');

    assert.strictEqual(output, expectedOutput, `Output for ${testName} should match expected output`);
  });
});
