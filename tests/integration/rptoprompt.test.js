const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { rpToPrompt } = require('../../rptoprompt.js');

test('rptoprompt processes prompt file correctly', async (t) => {
    // Create a simple writable stream to capture output
    class StringStream {
        constructor() {
            this.data = '';
        }
        write(chunk) {
            this.data += chunk.toString();
        }
    }

    const promptFile = path.join(__dirname, '../fixtures/input/test_prefix.prompt');
    const expectedOutputFile = path.join(__dirname, '../fixtures/output/rptoprompt_expected.txt');
    const outputStream = new StringStream();

    rpToPrompt(promptFile, outputStream);

    const output = outputStream.data;
    const fs = require('fs');
    const expectedOutput = fs.readFileSync(expectedOutputFile, 'utf8');

    assert.strictEqual(output, expectedOutput, 'Output should match expected output from fixture');
});
