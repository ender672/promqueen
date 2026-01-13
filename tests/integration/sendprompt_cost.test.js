const { test } = require('node:test');
const assert = require('node:assert');
const { sendPrompt } = require('../../sendprompt.js');

// Helper class to capture output
class StringStream {
    constructor() {
        this.data = '';
    }
    write(chunk) {
        this.data += chunk.toString();
    }
}

test('sendprompt logs cost to stderr when pricing and usage are present', async (t) => {
    // Mock global.fetch
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
        return {
            ok: true,
            status: 200,
            headers: {
                get: () => 'application/json'
            },
            json: async () => ({
                choices: [{ message: { content: 'Hello' } }],
                usage: {
                    prompt_tokens: 100,
                    completion_tokens: 50,
                    prompt_tokens_details: { cached_tokens: 20 }
                }
            })
        };
    };

    try {
        const outputStream = new StringStream();
        const errorStream = new StringStream();

        // Config with pricing included in the "cliConfig" for this test.
        const cliConfig = {
            pricing: {
                cost_uncached: 10, // $10 per million
                cost_cached: 5,    // $5 per million
                cost_output: 20    // $20 per million
            },
            api_url: 'http://example.com'
        };

        const prompt = `---
config:
  api_url: http://dummy
---
User: hi`;

        await sendPrompt(
            prompt,
            process.cwd(),
            outputStream,
            errorStream,
            cliConfig
        );

        // Verify output to stderr
        // Calculation:
        // Prompt: 100 total, 20 cached, 80 uncached. (80/1M*10 = 0.0008)
        // Cached: 20 / 1M * 5 = 0.0001
        // Output: 50 / 1M * 20 = 0.0010
        // Total: 0.0019
        // Expected string should contain "total cost: 0.00190¢"

        assert.match(errorStream.data, /total cost: 0.00190¢/, 'Stderr should contain correct cost calculation');
        assert.match(errorStream.data, /20.0% cached/, 'Stderr should contain correct cached percentage');

    } finally {
        global.fetch = originalFetch;
    }
});
