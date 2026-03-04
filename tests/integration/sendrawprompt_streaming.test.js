const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { sendRawPrompt } = require('../../sendrawprompt.js');
const { parseConfigAndMessages, resolveConfig } = require('../../lib/pqutils.js');

const fixturesDir = path.join(__dirname, '../fixtures/sendrawprompt');
const chatTemplatePath = path.join(fixturesDir, 'chatml.jinja');

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
const resolved = resolveConfig(promptConfig, process.cwd(), { chat_template_path: chatTemplatePath });
const messages = promptMessages.map(m => ({ ...m, role: m.name }));

test('sendrawprompt handles streaming SSE response', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => mockStreamingResponse([
        sseChunk(JSON.stringify({ choices: [{ text: 'Hello' }] })),
        sseChunk(JSON.stringify({ choices: [{ text: ' world' }] })),
        sseChunk(JSON.stringify({ choices: [{ text: '!' }] })),
        sseChunk('[DONE]')
    ]);

    try {
        const outputStream = new StringStream();
        const errorStream = new StringStream();

        await sendRawPrompt(messages, resolved, outputStream, errorStream);

        assert.strictEqual(outputStream.data, 'Hello world!');
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendrawprompt strips leading space from first streaming chunk', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => mockStreamingResponse([
        sseChunk(JSON.stringify({ choices: [{ text: ' Hello' }] })),
        sseChunk(JSON.stringify({ choices: [{ text: ' world' }] })),
        sseChunk('[DONE]')
    ]);

    try {
        const outputStream = new StringStream();
        const errorStream = new StringStream();

        await sendRawPrompt(messages, resolved, outputStream, errorStream);

        assert.strictEqual(outputStream.data, 'Hello world');
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendrawprompt strips leading newline from first streaming chunk', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => mockStreamingResponse([
        sseChunk(JSON.stringify({ choices: [{ text: '\nHello' }] })),
        sseChunk(JSON.stringify({ choices: [{ text: ' world' }] })),
        sseChunk('[DONE]')
    ]);

    try {
        const outputStream = new StringStream();
        const errorStream = new StringStream();

        await sendRawPrompt(messages, resolved, outputStream, errorStream);

        assert.strictEqual(outputStream.data, 'Hello world');
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendrawprompt throws on API error response', async () => {
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
        const errorStream = new StringStream();

        await assert.rejects(
            () => sendRawPrompt(messages, resolved, outputStream, errorStream),
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

test('sendrawprompt escapes {{ in streaming response', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => mockStreamingResponse([
        sseChunk(JSON.stringify({ choices: [{ text: 'Use {{ variable }} for substitution' }] })),
        sseChunk('[DONE]')
    ]);

    try {
        const outputStream = new StringStream();
        const errorStream = new StringStream();

        await sendRawPrompt(messages, resolved, outputStream, errorStream);

        assert.strictEqual(outputStream.data, 'Use \\{{ variable }} for substitution');
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendrawprompt escapes {{ across streaming chunk boundaries', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => mockStreamingResponse([
        sseChunk(JSON.stringify({ choices: [{ text: 'hello{' }] })),
        sseChunk(JSON.stringify({ choices: [{ text: '{world}}' }] })),
        sseChunk('[DONE]')
    ]);

    try {
        const outputStream = new StringStream();
        const errorStream = new StringStream();

        await sendRawPrompt(messages, resolved, outputStream, errorStream);

        assert.strictEqual(outputStream.data, 'hello\\{{world}}');
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendrawprompt escapes @ at start of lines in streaming response', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => mockStreamingResponse([
        sseChunk(JSON.stringify({ choices: [{ text: 'Here is info:\n\n@john is admin' }] })),
        sseChunk('[DONE]')
    ]);

    try {
        const outputStream = new StringStream();
        const errorStream = new StringStream();

        await sendRawPrompt(messages, resolved, outputStream, errorStream);

        assert.strictEqual(outputStream.data, 'Here is info:\n\n\\@john is admin');
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendrawprompt escapes @ at start of lines in non-streaming response', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => mockJsonResponse({
        choices: [{ text: 'Here is info:\n\n@john is admin' }]
    });

    try {
        const outputStream = new StringStream();
        const errorStream = new StringStream();

        await sendRawPrompt(messages, resolved, outputStream, errorStream);

        assert.strictEqual(outputStream.data, 'Here is info:\n\n\\@john is admin');
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendrawprompt throws when chat_template_path is missing', async () => {
    const outputStream = new StringStream();
    const errorStream = new StringStream();

    const noTemplateConfig = { ...resolved, chat_template_path: undefined };

    await assert.rejects(
        () => sendRawPrompt(messages, noTemplateConfig, outputStream, errorStream),
        (err) => {
            assert.match(err.message, /chat_template_path is required/);
            return true;
        }
    );
});
