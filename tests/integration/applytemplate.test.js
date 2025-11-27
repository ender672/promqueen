const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { applyTemplate } = require('../../applytemplate.js');

const fixturesDir = path.join(__dirname, '../fixtures/applytemplate');

// Helper class to capture output
class StringStream {
  constructor() {
    this.data = '';
  }
  write(chunk) {
    this.data += chunk.toString();
  }
}

// Find all input files
const files = fs.readdirSync(fixturesDir);
const inputFiles = files.filter(f => f.endsWith('.input.prompt'));

inputFiles.forEach(inputFile => {
  const testName = inputFile.replace('.input.prompt', '');
  const expectedOutputFile = inputFile.replace('.input.prompt', '.output.txt');

  test(`applytemplate processes ${testName}`, async (t) => {
    const inputPath = path.join(fixturesDir, inputFile);
    const outputPath = path.join(fixturesDir, expectedOutputFile);

    if (!fs.existsSync(outputPath)) {
      throw new Error(`Expected output file not found: ${outputPath}`);
    }

    const prompt = fs.readFileSync(inputPath, 'utf8');
    const outputStream = new StringStream();

    await applyTemplate(prompt, {}, outputStream);

    const output = outputStream.data;
    const expectedOutput = fs.readFileSync(outputPath, 'utf8');

    assert.strictEqual(output, expectedOutput, `Output for ${testName} should match expected output`);
  });
});
