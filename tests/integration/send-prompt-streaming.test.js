const { test } = require('node:test');
const assert = require('node:assert');
const { sendPrompt } = require('../../send-prompt.js');
const { parseConfigAndMessages, resolveConfig } = require('../../lib/pq-utils.js');

// Helper class to capture output
class StringStream {
    constructor() {
        this.data = '';
    }
    write(chunk) {
        this.data += chunk.toString();
    }
}

// Helper to create an SSE chunk from data
function sseChunk(data) {
    return new TextEncoder().encode(`data: ${data}\n\n`);
}

// Helper to create a mock non-streaming JSON response
function mockJsonResponse(jsonBody) {
    return {
        ok: true,
        status: 200,
        headers: {
            get: (name) => {
                if (name.toLowerCase() === 'content-type') return 'application/json';
                return null;
            }
        },
        json: async () => jsonBody
    };
}

// Helper to create a mock streaming response
function mockStreamingResponse(chunks) {
    const body = {
        async *[Symbol.asyncIterator]() {
            for (const chunk of chunks) {
                yield chunk;
            }
        }
    };
    return {
        ok: true,
        status: 200,
        headers: {
            get: (name) => {
                if (name.toLowerCase() === 'content-type') return 'text/event-stream';
                return null;
            }
        },
        body
    };
}

const promptText = `---
api_url: http://dummy
dot_config_loading: false
---
@user
Hello`;

const { config: promptConfig, messages: promptMessages } = parseConfigAndMessages(promptText);
const resolved = resolveConfig(promptConfig, process.cwd());
const messages = promptMessages;

test('sendprompt handles streaming SSE response', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => mockStreamingResponse([
        sseChunk(JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] })),
        sseChunk(JSON.stringify({ choices: [{ delta: { content: ' world' } }] })),
        sseChunk(JSON.stringify({ choices: [{ delta: { content: '!' } }] })),
        sseChunk('[DONE]')
    ]);

    try {
        const outputStream = new StringStream();

        await sendPrompt(messages, resolved, outputStream);

        assert.strictEqual(outputStream.data, 'Hello world!');
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendprompt strips leading space from first streaming chunk', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => mockStreamingResponse([
        sseChunk(JSON.stringify({ choices: [{ delta: { content: ' Hello' } }] })),
        sseChunk(JSON.stringify({ choices: [{ delta: { content: ' world' } }] })),
        sseChunk('[DONE]')
    ]);

    try {
        const outputStream = new StringStream();

        await sendPrompt(messages, resolved, outputStream);

        assert.strictEqual(outputStream.data, 'Hello world');
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendprompt strips leading newline from first streaming chunk', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => mockStreamingResponse([
        sseChunk(JSON.stringify({ choices: [{ delta: { content: '\nHello' } }] })),
        sseChunk(JSON.stringify({ choices: [{ delta: { content: ' world' } }] })),
        sseChunk('[DONE]')
    ]);

    try {
        const outputStream = new StringStream();

        await sendPrompt(messages, resolved, outputStream);

        assert.strictEqual(outputStream.data, 'Hello world');
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendprompt throws on API error response', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({
        ok: false,
        status: 429,
        headers: {
            get: () => null
        },
        text: async () => 'Rate limit exceeded'
    });

    try {
        const outputStream = new StringStream();

        await assert.rejects(
            () => sendPrompt(messages, resolved, outputStream),
            (err) => {
                assert.match(err.message, /API request failed: 429/);
                assert.match(err.message, /Rate limit exceeded/);
                return true;
            }
        );
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendprompt returns pricing on streaming response with usage', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => mockStreamingResponse([
        sseChunk(JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] })),
        sseChunk(JSON.stringify({
            choices: [{ delta: {} }],
            usage: {
                prompt_tokens: 100,
                completion_tokens: 50,
                prompt_tokens_details: { cached_tokens: 0 }
            }
        })),
        sseChunk('[DONE]')
    ]);

    try {
        const outputStream = new StringStream();

        const configWithPricing = {
            ...resolved,
            pricing: {
                cost_uncached: 10,
                cost_cached: 5,
                cost_output: 20
            }
        };

        const pricing = await sendPrompt(messages, configWithPricing, outputStream);

        assert.strictEqual(outputStream.data, 'Hi');
        assert.ok(pricing, 'Should return pricing object');
        assert.strictEqual(pricing.promptTokens, 100);
        assert.strictEqual(pricing.completionTokens, 50);
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendprompt escapes @ at start of lines in streaming response', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => mockStreamingResponse([
        sseChunk(JSON.stringify({ choices: [{ delta: { content: 'Here is info:\n\n@john is admin' } }] })),
        sseChunk('[DONE]')
    ]);

    try {
        const outputStream = new StringStream();

        await sendPrompt(messages, resolved, outputStream);

        assert.strictEqual(outputStream.data, 'Here is info:\n\n\\@john is admin');
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendprompt escapes @ at start of lines across streaming chunk boundaries', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => mockStreamingResponse([
        sseChunk(JSON.stringify({ choices: [{ delta: { content: 'Hello\n\n' } }] })),
        sseChunk(JSON.stringify({ choices: [{ delta: { content: '@john is here' } }] })),
        sseChunk('[DONE]')
    ]);

    try {
        const outputStream = new StringStream();

        await sendPrompt(messages, resolved, outputStream);

        assert.strictEqual(outputStream.data, 'Hello\n\n\\@john is here');
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendprompt escapes @ at start of lines in non-streaming response', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => mockJsonResponse({
        choices: [{ message: { content: 'Here is info:\n\n@john is admin' } }]
    });

    try {
        const outputStream = new StringStream();

        await sendPrompt(messages, resolved, outputStream);

        assert.strictEqual(outputStream.data, 'Here is info:\n\n\\@john is admin');
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendprompt escapes {{ in streaming response', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => mockStreamingResponse([
        sseChunk(JSON.stringify({ choices: [{ delta: { content: 'Use {{ variable }} for substitution' } }] })),
        sseChunk('[DONE]')
    ]);

    try {
        const outputStream = new StringStream();

        await sendPrompt(messages, resolved, outputStream);

        assert.strictEqual(outputStream.data, 'Use \\{{ variable }} for substitution');
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendprompt escapes {% in streaming response', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => mockStreamingResponse([
        sseChunk(JSON.stringify({ choices: [{ delta: { content: "Use {% include 'file.txt' %} for includes" } }] })),
        sseChunk('[DONE]')
    ]);

    try {
        const outputStream = new StringStream();

        await sendPrompt(messages, resolved, outputStream);

        assert.strictEqual(outputStream.data, "Use \\{% include 'file.txt' %} for includes");
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendprompt escapes {{ across streaming chunk boundaries', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => mockStreamingResponse([
        sseChunk(JSON.stringify({ choices: [{ delta: { content: 'hello{' } }] })),
        sseChunk(JSON.stringify({ choices: [{ delta: { content: '{world}}' } }] })),
        sseChunk('[DONE]')
    ]);

    try {
        const outputStream = new StringStream();

        await sendPrompt(messages, resolved, outputStream);

        assert.strictEqual(outputStream.data, 'hello\\{{world}}');
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendprompt escapes {% across streaming chunk boundaries', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => mockStreamingResponse([
        sseChunk(JSON.stringify({ choices: [{ delta: { content: 'hello{' } }] })),
        sseChunk(JSON.stringify({ choices: [{ delta: { content: "% include 'x' %}" } }] })),
        sseChunk('[DONE]')
    ]);

    try {
        const outputStream = new StringStream();

        await sendPrompt(messages, resolved, outputStream);

        assert.strictEqual(outputStream.data, "hello\\{% include 'x' %}");
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendprompt flushes lone trailing { in streaming response', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => mockStreamingResponse([
        sseChunk(JSON.stringify({ choices: [{ delta: { content: 'hello{' } }] })),
        sseChunk('[DONE]')
    ]);

    try {
        const outputStream = new StringStream();

        await sendPrompt(messages, resolved, outputStream);

        assert.strictEqual(outputStream.data, 'hello{');
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendprompt escapes {{ in non-streaming response', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => mockJsonResponse({
        choices: [{ message: { content: 'Use {{ var }} and {% include "f" %}' } }]
    });

    try {
        const outputStream = new StringStream();

        await sendPrompt(messages, resolved, outputStream);

        assert.strictEqual(outputStream.data, 'Use \\{{ var }} and \\{% include "f" %}');
    } finally {
        global.fetch = originalFetch;
    }
});
