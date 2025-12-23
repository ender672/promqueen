const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('fs');

const scriptPath = path.resolve(__dirname, '../../precompletionlint.js');
const fixturesDir = path.resolve(__dirname, '../fixtures/precompletionlint');

// Find all input files
const files = fs.readdirSync(fixturesDir);
const inputFiles = files.filter(f => f.endsWith('.input.prompt'));

inputFiles.forEach(inputFile => {
  const testName = inputFile.replace('.input.prompt', '').replace(/_/g, ' ');
  const expectedOutputFile = inputFile.replace('.input.prompt', '.output.txt');

  test(`precompletionlint ${testName}`, async (t) => {
    const inputPath = path.join(fixturesDir, inputFile);
    const outputPath = path.join(fixturesDir, expectedOutputFile);

    if (!fs.existsSync(outputPath)) {
      throw new Error(`Expected output file not found: ${outputPath}`);
    }

    const result = spawnSync('node', [scriptPath, inputPath], { encoding: 'utf8' });
    const output = result.stdout;
    const expectedOutput = fs.readFileSync(outputPath, 'utf8');

    assert.strictEqual(output, expectedOutput, `Output for ${testName} should match expected output`);
  });
});
