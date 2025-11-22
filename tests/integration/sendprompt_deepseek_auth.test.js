const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

test('DeepSeek auth validation', async (t) => {
  const mockServer = require('../mock_deepseek_server.js');
  const { sendPrompt } = require('../../sendprompt.js');
  const PORT = 0;

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
      const assignedPort = server.address().port;
      try {
        // Test Case 1: Valid Token
        await t.test('should succeed with valid Bearer token', async () => {
          const validPrompt = `---
api_url: http://localhost:${assignedPort}/chat/completions
api_call_headers:
  Authorization: Bearer sk-mock-key
  Content-Type: application/json
api_call_props:
  model: deepseek-coder
  stream: true
---
@user
Hello`;
          const stdout = new StringStream();
          const stderr = new StringStream();

          await sendPrompt(validPrompt, process.cwd(), process.cwd(), {}, stdout, stderr);
          assert.ok(stdout.data.length > 0, 'Should have received response data');
        });

        // Test Case 2: Missing Token
        await t.test('should fail without Authorization header', async () => {
          const noAuthPrompt = `---
api_url: http://localhost:${assignedPort}/chat/completions
api_call_headers:
  Content-Type: application/json
api_call_props:
  model: deepseek-coder
  stream: true
---
@user
Hello`;
          const stdout = new StringStream();
          const stderr = new StringStream();

          try {
            await sendPrompt(noAuthPrompt, process.cwd(), process.cwd(), {}, stdout, stderr);
            assert.fail('Should have thrown an error');
          } catch (err) {
            assert.match(err.message, /API request failed: 401/, 'Should fail with 401 Unauthorized');
          }
        });

        // Test Case 3: Invalid Token Format (not Bearer)
        await t.test('should fail with invalid token format', async () => {
          const invalidAuthPrompt = `---
api_url: http://localhost:${assignedPort}/chat/completions
api_call_headers:
  Authorization: Basic user:pass
  Content-Type: application/json
api_call_props:
  model: deepseek-coder
  stream: true
---
@user
Hello`;
          const stdout = new StringStream();
          const stderr = new StringStream();

          try {
            await sendPrompt(invalidAuthPrompt, process.cwd(), process.cwd(), {}, stdout, stderr);
            assert.fail('Should have thrown an error');
          } catch (err) {
            assert.match(err.message, /API request failed: 401/, 'Should fail with 401 Unauthorized');
          }
        });

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
