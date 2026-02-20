const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { resolveConfig, parseChatHistory, parseConfigOnly } = require('../../lib/pqutils.js');

test('resolveConfig honors dot_config_loading option and only checks home dir', async (t) => {
  // Mock os.homedir
  const originalHomedir = os.homedir;

  // Setup directory structure
  // /tmp/fake-home/
  //   .chathistory
  // /tmp/other-path/
  //   .chathistory (should be ignored)
  //   subdir/

  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pq-home-'));
  const otherPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pq-other-'));

  const homeConfig = path.join(fakeHome, '.chathistory');
  const otherConfig = path.join(otherPath, '.chathistory');
  const workingDir = path.join(otherPath, 'subdir');

  fs.mkdirSync(workingDir);

  // Define contents
  fs.writeFileSync(homeConfig, 'api_url: https://home.llm.com\n');
  fs.writeFileSync(otherConfig, 'api_url: https://other.llm.com\n');

  // Override homedir
  os.homedir = () => fakeHome;

  // Cleanup hook
  t.after(() => {
    os.homedir = originalHomedir;
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(otherPath, { recursive: true, force: true });
  });

  // Test 1: Should load from home dir
  const configHome = resolveConfig({}, workingDir);
  assert.strictEqual(configHome.api_url, 'https://home.llm.com', 'Should load config from home directory');

  // Test 2: Should NOT load from parent dir (otherPath) if it's not home
  // To test this effectively, we temporarily un-mock home or mock it to empty dir?
  // Actually, Test 1 proves it loads from home. 
  // We need to prove it does NOT load from `otherPath` even though `otherConfig` exists.
  // In `pqutils.js`, it ONLY checks home. So if we are in `workingDir`, and `root/otherPath/.chathistory` exists,
  // previous logic would have found it (walking up). New logic should SKIP it and go straight to `fakeHome`.
  // Since `configHome.api_url` is `https://home.llm.com`, this confirms it picked home OVER other (or ignored other).
  // Wait, resolveConfig merges? No, it loads one file? 
  // It finds ONE file. `findDotConfigFile` returns the first one found.
  // OLD logic: walk up. Would find `otherPath/.chathistory` first (closer).
  // NEW logic: check home. Should find `fakeHome/.chathistory`.

  // So Test 1 asserting 'https://home.llm.com' proves that it either:
  // a) Looked in home and found it.
  // b) Looked in parent, didn't find (or found and was overwritten? No, it returns path).

  // Let's explicitly test that if home has NO config, and parent DOES, it returns nothing/defaults.

  // Test 3: Homedir has no config, parent has config. Should be empty.
  fs.rmSync(homeConfig);
  const configNoHome = resolveConfig({}, workingDir);
  assert.strictEqual(configNoHome.api_url, undefined, 'Should NOT load config from parent directory if not in home');

  // Test 4: Explicitly disabled
  // Restore home config for this test
  fs.writeFileSync(homeConfig, 'api_url: https://home.llm.com\n');
  const configDisabled = resolveConfig({ dot_config_loading: false }, workingDir);
  assert.strictEqual(configDisabled.api_url, undefined, 'Should NOT load config when dot_config_loading is false');

});

test('parseChatHistory with input not starting with @ returns single unnamed message', () => {
  const input = 'Hello, this is just plain text without any @ prefix.';
  const result = parseChatHistory(input);
  assert.deepStrictEqual(result, [{ name: null, content: input }]);
});

test('parseChatHistory with multiline input not starting with @ returns single unnamed message', () => {
  const input = 'First line\nSecond line\nThird line';
  const result = parseChatHistory(input);
  assert.deepStrictEqual(result, [{ name: null, content: input }]);
});

test('parseChatHistory with empty string returns empty array', () => {
  assert.deepStrictEqual(parseChatHistory(''), []);
});

test('parseChatHistory with null input returns empty array', () => {
  assert.deepStrictEqual(parseChatHistory(null), []);
});

test('parseChatHistory with undefined input returns empty array', () => {
  assert.deepStrictEqual(parseChatHistory(undefined), []);
});

test('parseConfigOnly throws when input does not start with ---', () => {
  assert.throws(
    () => parseConfigOnly('no front matter here'),
    { message: "Invalid input: Text must start with '---'" }
  );
});

test('parseConfigOnly throws when input is null', () => {
  assert.throws(
    () => parseConfigOnly(null),
    { message: "Invalid input: Text must start with '---'" }
  );
});

test('parseConfigOnly throws when input is empty string', () => {
  assert.throws(
    () => parseConfigOnly(''),
    { message: "Invalid input: Text must start with '---'" }
  );
});

test('parseConfigOnly throws when closing --- is missing', () => {
  assert.throws(
    () => parseConfigOnly('---\nkey: value\nno closing separator'),
    { message: "Invalid format: Expected YAML front matter separating '---' not found" }
  );
});

test('resolveConfig merges profile settings when profile is selected', () => {
  const configContent = {
    dot_config_loading: false,
    profile: 'creative',
    profiles: {
      creative: {
        api_url: 'https://creative.example.com',
        temperature: 0.9,
      },
      precise: {
        api_url: 'https://precise.example.com',
        temperature: 0.1,
      },
    },
  };

  const result = resolveConfig(configContent, '/tmp');

  // Profile settings should be applied
  assert.strictEqual(result.api_url, 'https://creative.example.com');
  assert.strictEqual(result.temperature, 0.9);
});

test('resolveConfig profile settings are overridden by configContent', () => {
  const configContent = {
    dot_config_loading: false,
    profile: 'creative',
    api_url: 'https://override.example.com',
    profiles: {
      creative: {
        api_url: 'https://creative.example.com',
        custom_setting: 'from-profile',
      },
    },
  };

  const result = resolveConfig(configContent, '/tmp');

  // configContent (priority 5) overrides profile (priority 4)
  assert.strictEqual(result.api_url, 'https://override.example.com');
  // But profile settings not in configContent still come through
  assert.strictEqual(result.custom_setting, 'from-profile');
});

test('resolveConfig profile overrides cliConfig settings', () => {
  const configContent = {
    dot_config_loading: false,
    profile: 'creative',
    profiles: {
      creative: {
        api_url: 'https://creative.example.com',
      },
    },
  };
  const cliConfig = {
    api_url: 'https://cli.example.com',
  };

  const result = resolveConfig(configContent, '/tmp', cliConfig);

  // Profile (priority 4) overrides cliConfig (priority 3)
  assert.strictEqual(result.api_url, 'https://creative.example.com');
});

test('resolveConfig ignores profiles when no profile is selected', () => {
  const configContent = {
    dot_config_loading: false,
    profiles: {
      creative: {
        api_url: 'https://creative.example.com',
      },
    },
  };

  const result = resolveConfig(configContent, '/tmp');

  // No profile selected, so profile settings should not be applied
  assert.strictEqual(result.api_url, undefined);
});

test('resolveConfig ignores profile when named profile does not exist', () => {
  const configContent = {
    dot_config_loading: false,
    profile: 'nonexistent',
    profiles: {
      creative: {
        api_url: 'https://creative.example.com',
      },
    },
  };

  const result = resolveConfig(configContent, '/tmp');

  // Named profile doesn't exist, so no profile settings applied
  assert.strictEqual(result.api_url, undefined);
});

test('resolveConfig cliConfig overrides DEFAULT_SETTINGS', () => {
  const cliConfig = {
    roleplay_user: 'narrator',
  };

  const result = resolveConfig({ dot_config_loading: false }, '/tmp', cliConfig);

  // cliConfig (priority 3) overrides DEFAULT_SETTINGS (priority 1)
  assert.strictEqual(result.roleplay_user, 'narrator');
});

test('resolveConfig configContent overrides cliConfig', () => {
  const configContent = {
    dot_config_loading: false,
    api_url: 'https://runtime.example.com',
    temperature: 0.5,
  };
  const cliConfig = {
    api_url: 'https://cli.example.com',
    temperature: 0.8,
    model: 'gpt-4',
  };

  const result = resolveConfig(configContent, '/tmp', cliConfig);

  // configContent (priority 5) overrides cliConfig (priority 3)
  assert.strictEqual(result.api_url, 'https://runtime.example.com');
  assert.strictEqual(result.temperature, 0.5);
  // cliConfig settings not in configContent still come through
  assert.strictEqual(result.model, 'gpt-4');
});

test('resolveConfig cliConfig merges with defaults when no other layers present', () => {
  const cliConfig = {
    api_url: 'https://cli.example.com',
    custom_flag: true,
  };

  const result = resolveConfig({ dot_config_loading: false }, '/tmp', cliConfig);

  // cliConfig values are present
  assert.strictEqual(result.api_url, 'https://cli.example.com');
  assert.strictEqual(result.custom_flag, true);
  // DEFAULT_SETTINGS values still present for non-overridden keys
  assert.strictEqual(result.roleplay_user, 'user');
  assert.strictEqual(result.roleplay_combined_group_chat, false);
});

test('resolveConfig full priority ordering across all layers', async (t) => {
  const originalHomedir = os.homedir;
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pq-priority-'));
  const homeConfig = path.join(fakeHome, '.chathistory');

  // .chathistory file sets api_url and custom_a
  fs.writeFileSync(homeConfig, 'api_url: https://dotfile.example.com\ncustom_a: from-dotfile\ncustom_b: from-dotfile\n');
  os.homedir = () => fakeHome;

  t.after(() => {
    os.homedir = originalHomedir;
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  const cliConfig = {
    api_url: 'https://cli.example.com',  // overrides dotfile
    custom_b: 'from-cli',                // overrides dotfile
    custom_c: 'from-cli',
  };
  const configContent = {
    api_url: 'https://runtime.example.com', // overrides cli and dotfile
    profile: 'myprofile',
    profiles: {
      myprofile: {
        custom_c: 'from-profile',         // overrides cli
        custom_d: 'from-profile',
      },
    },
  };

  const result = resolveConfig(configContent, '/tmp', cliConfig);

  // configContent (5) wins over all for api_url
  assert.strictEqual(result.api_url, 'https://runtime.example.com');
  // dotfile (2) value survives when not overridden by higher layers
  assert.strictEqual(result.custom_a, 'from-dotfile');
  // cli (3) overrides dotfile (2) for custom_b
  assert.strictEqual(result.custom_b, 'from-cli');
  // profile (4) overrides cli (3) for custom_c
  assert.strictEqual(result.custom_c, 'from-profile');
  // profile (4) provides custom_d
  assert.strictEqual(result.custom_d, 'from-profile');
  // DEFAULT_SETTINGS (1) provides roleplay_user since no layer overrides it
  assert.strictEqual(result.roleplay_user, 'user');
});
