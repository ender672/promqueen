const { test } = require('node:test');
const assert = require('node:assert');
const { sendPrompt, pricingToString } = require('../../send-prompt.js');

// Helper class to capture output
class StringStream {
    constructor() {
        this.data = '';
    }
    write(chunk) {
        this.data += chunk.toString();
    }
}

test('sendprompt returns pricing object when pricing and usage are present', async () => {
    // Mock global.fetch
    const originalFetch = global.fetch;
    global.fetch = async () => {
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

        const resolvedConfig = {
            pricing: {
                cost_uncached: 10,
                cost_cached: 5,
                cost_output: 20
            },
            api_url: 'http://example.com',
            api_call_headers: {},
            api_call_props: {},
        };

        const messages = [{ role: 'user', content: 'hi' }];

        const pricing = await sendPrompt(messages, resolvedConfig, outputStream);

        assert.ok(pricing, 'Should return pricing object');
        assert.strictEqual(pricing.promptTokens, 100);
        assert.strictEqual(pricing.cachedTokens, 20);
        assert.strictEqual(pricing.completionTokens, 50);
        assert.strictEqual(pricing.cachedPercentage, 20);

        const costString = pricingToString(pricing);
        assert.match(costString, /total cost: 0.00190¢/, 'Should contain correct cost calculation');
        assert.match(costString, /20.0% cached/, 'Should contain correct cached percentage');

    } finally {
        global.fetch = originalFetch;
    }
});

test('sendprompt cost calculation with zero prompt tokens avoids division by zero', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
        return {
            ok: true,
            status: 200,
            headers: {
                get: () => 'application/json'
            },
            json: async () => ({
                choices: [{ message: { content: 'Hello' } }],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 50,
                    prompt_tokens_details: { cached_tokens: 0 }
                }
            })
        };
    };

    try {
        const outputStream = new StringStream();

        const resolvedConfig = {
            pricing: {
                cost_uncached: 10,
                cost_cached: 5,
                cost_output: 20
            },
            api_url: 'http://example.com',
            api_call_headers: {},
            api_call_props: {},
        };

        const messages = [{ role: 'user', content: 'hi' }];

        const pricing = await sendPrompt(messages, resolvedConfig, outputStream);

        assert.ok(pricing, 'Should return pricing object');
        assert.strictEqual(pricing.cachedPercentage, 0, 'Should show 0% cached, not NaN');

        const costString = pricingToString(pricing);
        assert.match(costString, /total cost: 0.00100¢/, 'Should compute correct total with zero prompt tokens');
        assert.match(costString, /0\.0% cached/, 'Should show 0.0% cached, not NaN');
        assert.doesNotMatch(costString, /NaN/, 'Should not contain NaN');
        assert.doesNotMatch(costString, /Infinity/, 'Should not contain Infinity');

    } finally {
        global.fetch = originalFetch;
    }
});
