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

    const promptFile = path.join(__dirname, '../fixtures/test_prefix.prompt');
    const outputStream = new StringStream();

    rpToPrompt(promptFile, outputStream);

    const output = outputStream.data;

    // Verify YAML front matter
    assert.ok(output.includes('api_url: https://api.deepseek.com/beta/chat/completions'), 'Output should contain api_url');

    // Verify messages
    assert.ok(output.includes('@user\nWrite a python function to calculate factorial.'), 'Output should contain user message');
    assert.ok(output.includes('@assistant\ndef factorial(n):'), 'Output should contain assistant message');
});
