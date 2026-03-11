import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
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
