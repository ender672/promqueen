const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { resolveConfig } = require('../../lib/pqutils.js');

test('resolveConfig honors dot_config_loading option', async (t) => {
    // Setup a temporary directory structure
    // /tmp/test-dir/
    //   .chathistory (contains user: 'config_user')
    //   subdir/

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pq-test-'));
    const configFile = path.join(tmpDir, '.chathistory');
    const subDir = path.join(tmpDir, 'subdir');

    fs.mkdirSync(subDir);
    fs.writeFileSync(configFile, 'user: config_user\n');

    // Test 1: Default behavior (should load config)
    const configDefault = resolveConfig({}, subDir);
    assert.strictEqual(configDefault.user, 'config_user', 'Should load config from parent directory by default');

    // Test 2: Explicitly enabled (should load config)
    const configEnabled = resolveConfig({ dot_config_loading: true }, subDir);
    assert.strictEqual(configEnabled.user, 'config_user', 'Should load config when dot_config_loading is true');

    // Test 3: Explicitly disabled (should NOT load config)
    const configDisabled = resolveConfig({ dot_config_loading: false }, subDir);
    // Default user is 'user' from DEFAULT_SETTINGS in pqutils.js
    assert.strictEqual(configDisabled.user, 'user', 'Should NOT load config when dot_config_loading is false');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
