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

// Helper to create an SSE chunk from data
function sseChunk(data) {
    return new TextEncoder().encode(`data: ${data}\n\n`);
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

const prompt = `---
api_url: http://dummy
dot_config_loading: false
---
@user
Hello`;

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
        const errorStream = new StringStream();

        await sendPrompt(prompt, process.cwd(), outputStream, errorStream);

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
        const errorStream = new StringStream();

        await sendPrompt(prompt, process.cwd(), outputStream, errorStream);

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
        const errorStream = new StringStream();

        await sendPrompt(prompt, process.cwd(), outputStream, errorStream);

        assert.strictEqual(outputStream.data, 'Hello world');
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendprompt logs cost on streaming response with usage', async () => {
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
        const errorStream = new StringStream();

        const cliConfig = {
            pricing: {
                cost_uncached: 10,
                cost_cached: 5,
                cost_output: 20
            }
        };

        await sendPrompt(prompt, process.cwd(), outputStream, errorStream, cliConfig);

        assert.strictEqual(outputStream.data, 'Hi');
        assert.match(errorStream.data, /total cost:/);
    } finally {
        global.fetch = originalFetch;
    }
});
