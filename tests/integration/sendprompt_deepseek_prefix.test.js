const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

test('DeepSeek prefix completion', async (t) => {
    const mockServer = require('../mock_deepseek_server.js');
    const { sendPrompt } = require('../../sendprompt.js');
    const PORT = 4000;

    // Create a simple writable stream to capture output
    class StringStream {
        constructor() {
            this.data = '';
        }
        write(chunk) {
            this.data += chunk.toString();
        }
    }

    await new Promise((resolve, reject) => {
        const server = mockServer.listen(PORT, async () => {
            try {
                const promptFile = path.join(__dirname, '../fixtures/test_deepseek_mock.prompt');
                const stdoutStream = new StringStream();
                const stderrStream = new StringStream();

                await sendPrompt({ promptPath: promptFile }, stdoutStream, stderrStream);

                const stdout = stdoutStream.data;

                // Check if the output contains expected python code that follows "def factorial(n):"
                // We expect something like "if n == 0:" or "return 1" or "return n * factorial(n-1)"
                const expectedPatterns = [
                    'if n == 0',
                    'return 1',
                    'return n *'
                ];

                const hasExpectedPattern = expectedPatterns.some(pattern => stdout.includes(pattern));

                assert.ok(hasExpectedPattern, `Output did not contain expected factorial logic. Output:\n${stdout}`);
                resolve();
            } catch (err) {
                reject(err);
            } finally {
                server.close();
            }
        });
        server.on('error', reject);
    });
});
