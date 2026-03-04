const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { runPipeline } = require('../../promqueen.js');

const fixturesDir = path.join(__dirname, '../fixtures/promqueen');

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

function sseChunk(data) {
    return new TextEncoder().encode(`data: ${data}\n\n`);
}

function mockFetchJSON(responseBody) {
    return async () => ({
        ok: true,
        status: 200,
        headers: {
            get: (name) => name.toLowerCase() === 'content-type' ? 'application/json' : null
        },
        json: async () => responseBody
    });
}

function mockFetchStreaming(chunks) {
    return async () => ({
        ok: true,
        status: 200,
        headers: {
            get: (name) => name.toLowerCase() === 'content-type' ? 'text/event-stream' : null
        },
        body: {
            async *[Symbol.asyncIterator]() {
                for (const chunk of chunks) {
                    yield sseChunk(JSON.stringify(chunk));
                }
                yield sseChunk('[DONE]');
            }
        }
    });
}

// Find all input files
const files = fs.readdirSync(fixturesDir);
const inputFiles = files.filter(f => f.endsWith('.input.pqueen'));

inputFiles.forEach(inputFile => {
    const testName = inputFile.replace('.input.pqueen', '');

    const inputPath = path.join(fixturesDir, inputFile);
    const outputPath = path.join(fixturesDir, `${testName}.output.pqueen`);
    const requestPath = path.join(fixturesDir, `${testName}.request.json`);
    const responsePath = path.join(fixturesDir, `${testName}.response.json`);
    const streamingResponsePath = path.join(fixturesDir, `${testName}.response.ndjson`);

    test(`promqueen pipeline - ${testName}`, async () => {
        assert.ok(fs.existsSync(outputPath), `Missing output fixture: ${outputPath}`);
        assert.ok(fs.existsSync(requestPath), `Missing request fixture: ${requestPath}`);

        const input = fs.readFileSync(inputPath, 'utf8');
        const expectedOutput = fs.readFileSync(outputPath, 'utf8');
        const expectedRequest = JSON.parse(fs.readFileSync(requestPath, 'utf8'));

        const memFS = createMemoryFS(input);
        let capturedUrl, capturedOptions;

        const originalFetch = global.fetch;

        if (fs.existsSync(streamingResponsePath)) {
            const chunks = fs.readFileSync(streamingResponsePath, 'utf8')
                .trim().split('\n').map(line => JSON.parse(line));
            global.fetch = async (url, options) => {
                capturedUrl = url;
                capturedOptions = options;
                return mockFetchStreaming(chunks)();
            };
        } else {
            const responseBody = JSON.parse(fs.readFileSync(responsePath, 'utf8'));
            global.fetch = async (url, options) => {
                capturedUrl = url;
                capturedOptions = options;
                return mockFetchJSON(responseBody)();
            };
        }

        try {
            await runPipeline('/fake/test.pqueen', {
                baseDir: process.cwd(),
                cwd: process.cwd(),
                stderr: { write() {} },
                fileSystem: memFS,
                quiet: true
            });

            // Verify request
            assert.strictEqual(capturedUrl, expectedRequest.url);
            assert.strictEqual(capturedOptions.method, expectedRequest.method);
            assert.deepStrictEqual(JSON.parse(capturedOptions.body), expectedRequest.body);

            // Verify final file content
            assert.strictEqual(memFS.getContent(), expectedOutput);
        } finally {
            global.fetch = originalFetch;
        }
    });
});
