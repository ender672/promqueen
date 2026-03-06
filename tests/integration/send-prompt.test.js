const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { sendPrompt } = require('../../send-prompt.js');
const { parseConfigAndMessages, resolveConfig } = require('../../lib/pq-utils.js');

const fixturesDir = path.join(__dirname, '../fixtures/send-prompt');

// Helper class to capture output
class StringStream {
  constructor() {
    this.data = '';
  }
  write(chunk) {
    this.data += chunk.toString();
  }
}

// Find all input files
const files = fs.readdirSync(fixturesDir);
const inputFiles = files.filter(f => f.endsWith('.input.pqueen'));

inputFiles.forEach(inputFile => {
  const testName = inputFile.replace('.input.pqueen', '');
  const requestExpectationFile = inputFile.replace('.input.pqueen', '.request.json');

  test(`sendprompt processes ${testName}`, async () => {
    const inputPath = path.join(fixturesDir, inputFile);
    const requestExpectationPath = path.join(fixturesDir, requestExpectationFile);

    if (!fs.existsSync(requestExpectationPath)) {
      throw new Error(`Request expectation file not found: ${requestExpectationPath}`);
    }

    const prompt = fs.readFileSync(inputPath, 'utf8');
    const { config, messages } = parseConfigAndMessages(prompt);
    const resolved = resolveConfig(config, process.cwd());
    const expectedRequest = JSON.parse(fs.readFileSync(requestExpectationPath, 'utf8'));

    let capturedUrl;
    let capturedOptions;

    // Mock global.fetch
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name) => {
            if (name.toLowerCase() === 'content-type') return 'application/json';
            return null;
          }
        },
        json: async () => ({ choices: [] }), // Minimal mock response
        text: async () => JSON.stringify({ choices: [] })
      };
    };

    try {
      const outputStream = new StringStream();
      const errorStream = new StringStream();

      await sendPrompt(
        messages,
        resolved,
        outputStream
      );

      assert.strictEqual(capturedUrl, expectedRequest.url, `URL for ${testName} should match`);
      assert.strictEqual(capturedOptions.method, expectedRequest.method, `Method for ${testName} should match`);

      const capturedBody = JSON.parse(capturedOptions.body);
      assert.deepStrictEqual(capturedBody, expectedRequest.body, `Body for ${testName} should match`);

      // Optional: Validate headers if expectedRequest has them
      if (expectedRequest.headers) {
        for (const [key, value] of Object.entries(expectedRequest.headers)) {
          assert.strictEqual(capturedOptions.headers[key], value, `Header ${key} for ${testName} should match`);
        }
      }

    } finally {
      // Restore global.fetch
      global.fetch = originalFetch;
    }
  });
});
