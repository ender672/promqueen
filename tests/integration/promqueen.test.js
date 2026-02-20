const { test } = require('node:test');
const assert = require('node:assert');
const { runPipeline } = require('../../promqueen.js');

// A minimal in-memory file system that supports the operations runPipeline uses:
// readFileSync, appendFileSync, createWriteStream
function createMemoryFS(initialContent) {
    let content = initialContent;

    return {
        readFileSync(_filePath, _encoding) {
            return content;
        },
        appendFileSync(_filePath, data) {
            content += data;
        },
        createWriteStream(_filePath, _options) {
            const listeners = {};
            return {
                write(chunk) {
                    content += chunk.toString();
                },
                end() {
                    // Defer finish event so that on('finish') can register first
                    process.nextTick(() => {
                        if (listeners['finish']) {
                            for (const fn of listeners['finish']) fn();
                        }
                    });
                },
                on(event, fn) {
                    if (!listeners[event]) listeners[event] = [];
                    listeners[event].push(fn);
                    return this;
                }
            };
        },
        getContent() {
            return content;
        }
    };
}

test('runPipeline end-to-end: precompletionlint -> applytemplate -> rptoprompt -> sendprompt -> postcompletionlint', async () => {
    // A simple two-message conversation between user and a character.
    // precompletionlint should add padding and guess the next speaker.
    // applytemplate passes through (no templates).
    // rptoprompt converts names to roles and adds impersonation instruction.
    // sendprompt calls the API and writes the response.
    // postcompletionlint adds padding and guesses the next speaker.
    const inputContent = `---
api_url: http://dummy
dot_config_loading: false
roleplay_user: User
roleplay_impersonation_instruction: "Write as {{char}}."
---
@User
Hello there!

@Alice
Hi! How are you?

@User
I'm fine.

@Alice
`;

    const memFS = createMemoryFS(inputContent);

    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
        // Verify the request was sent to the right URL
        assert.strictEqual(url, 'http://dummy');
        assert.strictEqual(options.method, 'POST');

        const body = JSON.parse(options.body);
        // Verify messages were converted to roles
        assert.ok(body.messages.length > 0, 'Should have messages in request body');
        // The last message from sendprompt should be the impersonation instruction
        const lastUserMsg = body.messages.filter(m => m.role === 'user').pop();
        assert.ok(lastUserMsg, 'Should have at least one user message');
        assert.match(lastUserMsg.content, /Write as Alice/, 'Should have impersonation instruction with char name');

        return {
            ok: true,
            status: 200,
            headers: {
                get: (name) => {
                    if (name.toLowerCase() === 'content-type') return 'application/json';
                    return null;
                }
            },
            json: async () => ({
                choices: [{ message: { content: 'Great to hear!' } }]
            })
        };
    };

    // Mock stderr to suppress pipeline logging
    const stderr = { write() {} };

    try {
        await runPipeline('/fake/test.pqueen', {
            baseDir: process.cwd(),
            cwd: process.cwd(),
            stderr,
            fileSystem: memFS
        });

        const finalContent = memFS.getContent();

        // The API response should have been appended
        assert.ok(finalContent.includes('Great to hear!'), 'Final content should include API response');

        // postcompletionlint should have guessed the next speaker (User, since Alice just spoke)
        assert.ok(finalContent.includes('@User'), 'Final content should include next speaker guess from postcompletionlint');
    } finally {
        global.fetch = originalFetch;
    }
});

test('runPipeline end-to-end with streaming response', async () => {
    const inputContent = `---
api_url: http://dummy
dot_config_loading: false
roleplay_user: User
roleplay_impersonation_instruction: "Respond as {{char}}."
---
@User
Tell me a joke.

@Bot
`;

    const memFS = createMemoryFS(inputContent);

    // Helper to create an SSE chunk
    function sseChunk(data) {
        return new TextEncoder().encode(`data: ${data}\n\n`);
    }

    const originalFetch = global.fetch;
    global.fetch = async () => {
        const body = {
            async *[Symbol.asyncIterator]() {
                yield sseChunk(JSON.stringify({ choices: [{ delta: { content: 'Why did the chicken' } }] }));
                yield sseChunk(JSON.stringify({ choices: [{ delta: { content: ' cross the road?' } }] }));
                yield sseChunk('[DONE]');
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
    };

    const stderr = { write() {} };

    try {
        await runPipeline('/fake/test.pqueen', {
            baseDir: process.cwd(),
            cwd: process.cwd(),
            stderr,
            fileSystem: memFS
        });

        const finalContent = memFS.getContent();

        // The streamed response should have been appended
        assert.ok(finalContent.includes('Why did the chicken cross the road?'),
            'Final content should include streamed API response');

        // postcompletionlint should guess User as next speaker
        assert.ok(finalContent.includes('@User'),
            'Final content should include next speaker guess');
    } finally {
        global.fetch = originalFetch;
    }
});
