const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { rpToHtml } = require('../../rptohtml.js');

const fixturesDir = path.join(__dirname, '../fixtures/rptohtml');

const files = fs.readdirSync(fixturesDir);
const inputFiles = files.filter(f => f.endsWith('.input.pqueen'));

inputFiles.forEach(inputFile => {
  const testName = inputFile.replace('.input.pqueen', '');
  const templateFile = testName + '.template.mustache';
  const expectedOutputFile = testName + '.output.html';

  test(`rptohtml renders ${testName}`, async () => {
    const inputPath = path.join(fixturesDir, inputFile);
    const templatePath = path.join(fixturesDir, templateFile);
    const outputPath = path.join(fixturesDir, expectedOutputFile);

    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template file not found: ${templatePath}`);
    }
    if (!fs.existsSync(outputPath)) {
      throw new Error(`Expected output file not found: ${outputPath}`);
    }

    const promptText = fs.readFileSync(inputPath, 'utf8').replace(/\r\n/g, '\n');
    const templateText = fs.readFileSync(templatePath, 'utf8');
    const expectedOutput = fs.readFileSync(outputPath, 'utf8');

    const output = rpToHtml(promptText, templateText);

    assert.strictEqual(output, expectedOutput, `Output for ${testName} should match expected output`);
  });
});
