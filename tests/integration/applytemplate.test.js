const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { applyTemplate } = require('../../applytemplate.js');

const fixturesDir = path.join(__dirname, '../fixtures/applytemplate');


// Find all input files
const files = fs.readdirSync(fixturesDir);
const inputFiles = files.filter(f => f.endsWith('.input.prompt'));

inputFiles.forEach(inputFile => {
  const testName = inputFile.replace('.input.prompt', '');
  const expectedOutputFile = inputFile.replace('.input.prompt', '.output.txt');

  test(`applytemplate - ${testName}`, async () => {
    const inputPath = path.join(fixturesDir, inputFile);
    const outputPath = path.join(fixturesDir, expectedOutputFile);

    if (!fs.existsSync(outputPath)) {
      throw new Error(`Expected output file not found: ${outputPath}`);
    }

    const prompt = fs.readFileSync(inputPath, 'utf8');

    const output = await applyTemplate(prompt, {});

    const expectedOutput = fs.readFileSync(outputPath, 'utf8');

    assert.strictEqual(output, expectedOutput, `Output for ${testName} should match expected output`);
  });
});
