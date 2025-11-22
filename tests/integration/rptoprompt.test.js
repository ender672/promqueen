const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { rpToPrompt } = require('../../rptoprompt.js');
const fs = require('fs');

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

    const prompt = fs.readFileSync(path.join(__dirname, '../fixtures/input/test_prefix.prompt'), 'utf8');
    const expectedOutputFile = path.join(__dirname, '../fixtures/output/rptoprompt_expected.txt');
    const outputStream = new StringStream();

    await rpToPrompt(prompt, outputStream);

    const output = outputStream.data;
    const expectedOutput = fs.readFileSync(expectedOutputFile, 'utf8');

    assert.strictEqual(output, expectedOutput, 'Output should match expected output from fixture');
});
