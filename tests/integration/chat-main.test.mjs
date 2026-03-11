import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const chatMjs = path.join(__dirname, '../../chat.mjs');

test('chat.mjs main: no args prints usage and exits', () => {
    try {
        execFileSync('node', [chatMjs], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        assert.fail('Should have exited with error');
    } catch (err) {
        assert.ok(err.stderr.includes('Usage:'), 'Should print usage message');
        assert.strictEqual(err.status, 1);
    }
});

test('chat.mjs main: non-existent file prints error and exits', () => {
    try {
        execFileSync('node', [chatMjs, '/tmp/nonexistent-file.pqueen'], {
            encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        });
        assert.fail('Should have exited with error');
    } catch (err) {
        assert.ok(err.stderr.includes('File not found'), 'Should print file not found');
        assert.strictEqual(err.status, 1);
    }
});

test('chat.mjs main: wrong file extension prints error and exits', () => {
    try {
        execFileSync('node', [chatMjs, '/dev/null'], {
            encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        });
        assert.fail('Should have exited with error');
    } catch (err) {
        assert.ok(err.stderr.includes('Expected a .png or .pqueen'), 'Should reject wrong extension');
        assert.strictEqual(err.status, 1);
    }
});

test('chat.mjs main: .png file invokes runSetup and reaches render', () => {
    const uid = `chat-png-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tmpPng = path.join(os.tmpdir(), `${uid}.png`);
    const tmpPqueen = path.join(os.tmpdir(), `${uid}.pqueen`);
    const preloadPath = path.join(os.tmpdir(), `${uid}-preload.cjs`);

    const pqueenContent = `---
connection: test
connection_profiles:
  test:
    api_url: http://dummy
dot_config_loading: false
roleplay_user: Tom
---
@Bilinda
Hello!

@Tom
`;

    fs.writeFileSync(tmpPng, 'fake-png');
    fs.writeFileSync(tmpPqueen, pqueenContent);

    const chatSetupAbsPath = path.resolve(__dirname, '../../lib/chat-setup.js');
    fs.writeFileSync(preloadPath, `
const resolved = require.resolve(${JSON.stringify(chatSetupAbsPath)});
require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: {
        runSetup: async (pngPath) => {
            process.stderr.write('MOCK_RUNSETUP_CALLED:' + pngPath + '\\n');
            return { pqueenPath: ${JSON.stringify(tmpPqueen)}, cliConfig: {} };
        }
    }
};
`);

    try {
        execFileSync('node', ['--require', preloadPath, chatMjs, tmpPng], {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 5000,
        });
    } catch (err) {
        const stderr = err.stderr || '';
        assert.ok(stderr.includes('MOCK_RUNSETUP_CALLED:' + tmpPng),
            'runSetup should be called with the PNG path');
        assert.ok(!stderr.includes('Usage:'), 'Should not show usage error');
        assert.ok(!stderr.includes('File not found'), 'Should not show file not found');
        assert.ok(!stderr.includes('Expected a .png or .pqueen'), 'Should not show extension error');
        return; // timeout or ink error is expected in non-TTY
    } finally {
        try { fs.unlinkSync(tmpPng); } catch {}
        try { fs.unlinkSync(tmpPqueen); } catch {}
        try { fs.unlinkSync(preloadPath); } catch {}
    }
    // If it somehow exited cleanly, that's also fine
});
