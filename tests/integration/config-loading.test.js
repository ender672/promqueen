const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { resolveConfig, parseConfigOnly, getConnectionProfile, expandEnvVars } = require('../../lib/pq-utils.js');

test('resolveConfig honors dot_config_loading option and only checks home dir', async (t) => {
  const originalHomedir = os.homedir;

  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pq-home-'));
  const otherPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pq-other-'));

  const homeConfig = path.join(fakeHome, '.promqueen');
  const otherConfig = path.join(otherPath, '.promqueen');
  const workingDir = path.join(otherPath, 'subdir');

  fs.mkdirSync(workingDir);

  fs.writeFileSync(homeConfig, 'custom_home: from-home\n');
  fs.writeFileSync(otherConfig, 'custom_other: from-other\n');

  os.homedir = () => fakeHome;

  t.after(() => {
    os.homedir = originalHomedir;
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(otherPath, { recursive: true, force: true });
  });

  // Test 1: Should load from home dir
  const configHome = resolveConfig({}, workingDir);
  assert.strictEqual(configHome.custom_home, 'from-home', 'Should load config from home directory');

  // Test 2: Homedir has no config, parent has config. Should not load parent.
  fs.rmSync(homeConfig);
  const configNoHome = resolveConfig({}, workingDir);
  assert.strictEqual(configNoHome.custom_other, undefined, 'Should NOT load config from parent directory if not in home');

  // Test 3: Explicitly disabled
  fs.writeFileSync(homeConfig, 'custom_home: from-home\n');
  const configDisabled = resolveConfig({ dot_config_loading: false }, workingDir);
  assert.strictEqual(configDisabled.custom_home, undefined, 'Should NOT load config when dot_config_loading is false');
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

test('resolveConfig cliConfig overrides DEFAULT_SETTINGS', () => {
  const cliConfig = {
    roleplay_user: 'narrator',
  };

  const result = resolveConfig({ dot_config_loading: false }, '/tmp', cliConfig);

  assert.strictEqual(result.roleplay_user, 'narrator');
});

test('resolveConfig configContent overrides cliConfig', () => {
  const configContent = {
    dot_config_loading: false,
    custom_a: 'from-content',
  };
  const cliConfig = {
    custom_a: 'from-cli',
    custom_b: 'from-cli',
  };

  const result = resolveConfig(configContent, '/tmp', cliConfig);

  assert.strictEqual(result.custom_a, 'from-content');
  assert.strictEqual(result.custom_b, 'from-cli');
});

test('resolveConfig cliConfig merges with defaults when no other layers present', () => {
  const cliConfig = {
    custom_flag: true,
  };

  const result = resolveConfig({ dot_config_loading: false }, '/tmp', cliConfig);

  assert.strictEqual(result.custom_flag, true);
  assert.strictEqual(result.roleplay_user, 'user');
  assert.strictEqual(result.roleplay_combined_group_chat, false);
});

test('resolveConfig validates connection profile exists', () => {
  const configContent = {
    dot_config_loading: false,
    connection: 'claude-haiku',
    connection_profiles: {
      'claude-haiku': {
        api_url: 'https://api.anthropic.com/v1/messages',
        api_call_headers: { 'x-api-key': 'test-key' },
        api_call_props: { model: 'claude-haiku-4-5-20251001', stream: true },
        pricing: { cost_uncached: 100, cost_cached: 10, cost_output: 500 },
      },
    },
  };

  const result = resolveConfig(configContent, '/tmp');
  const conn = getConnectionProfile(result);

  assert.strictEqual(conn.api_url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(conn.api_call_props.model, 'claude-haiku-4-5-20251001');
  assert.strictEqual(conn.pricing.cost_uncached, 100);
});

test('resolveConfig throws when connection is missing', () => {
  assert.throws(
    () => resolveConfig({
      dot_config_loading: false,
      connection: null,
    }, '/tmp'),
    { message: /Missing required config: connection/ }
  );
});

test('resolveConfig throws when connection profile does not exist', () => {
  assert.throws(
    () => resolveConfig({
      dot_config_loading: false,
      connection: 'nonexistent',
      connection_profiles: {
        'claude-haiku': {
          api_url: 'https://api.anthropic.com/v1/messages',
        },
      },
    }, '/tmp'),
    { message: /Connection profile 'nonexistent' not found/ }
  );
});

test('resolveConfig connection_profiles from different layers are deep-merged', () => {
  const configContent = {
    dot_config_loading: false,
    connection: 'custom',
    connection_profiles: {
      custom: {
        api_url: 'https://custom.example.com',
        api_call_props: { model: 'custom-model' },
      },
    },
  };

  const result = resolveConfig(configContent, '/tmp');
  const conn = getConnectionProfile(result);

  assert.strictEqual(conn.api_url, 'https://custom.example.com');
  assert.strictEqual(conn.api_call_props.model, 'custom-model');
});

test('expandEnvVars expands $VAR in headers', () => {
  process.env.PQ_TEST_API_KEY = 'sk-test-12345';
  try {
    const result = expandEnvVars({
      Authorization: 'Bearer $PQ_TEST_API_KEY',
    });
    assert.strictEqual(result.Authorization, 'Bearer sk-test-12345');
  } finally {
    delete process.env.PQ_TEST_API_KEY;
  }
});

test('expandEnvVars expands ${VAR} in headers', () => {
  process.env.PQ_TEST_API_KEY = 'sk-test-67890';
  try {
    const result = expandEnvVars({
      'x-api-key': '${PQ_TEST_API_KEY}',
    });
    assert.strictEqual(result['x-api-key'], 'sk-test-67890');
  } finally {
    delete process.env.PQ_TEST_API_KEY;
  }
});

test('expandEnvVars throws for undefined env vars', () => {
  delete process.env.PQ_TEST_NONEXISTENT_VAR;
  assert.throws(
    () => expandEnvVars({
      Authorization: 'Bearer $PQ_TEST_NONEXISTENT_VAR',
    }),
    { message: /Environment variable PQ_TEST_NONEXISTENT_VAR is not set/ }
  );
});

test('expandEnvVars passes through non-string values unchanged', () => {
  const result = expandEnvVars({ 'X-Numeric': 42 });
  assert.strictEqual(result['X-Numeric'], 42);
});

test('resolveConfig full priority ordering across all layers', async (t) => {
  const originalHomedir = os.homedir;
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pq-priority-'));
  const homeConfig = path.join(fakeHome, '.promqueen');

  fs.writeFileSync(homeConfig, 'custom_a: from-dotfile\ncustom_b: from-dotfile\n');
  os.homedir = () => fakeHome;

  t.after(() => {
    os.homedir = originalHomedir;
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  const cliConfig = {
    custom_b: 'from-cli',
    custom_c: 'from-cli',
  };
  const configContent = {
    custom_c: 'from-content',
  };

  const result = resolveConfig(configContent, '/tmp', cliConfig);

  // dotfile (2) value survives when not overridden by higher layers
  assert.strictEqual(result.custom_a, 'from-dotfile');
  // cli (3) overrides dotfile (2) for custom_b
  assert.strictEqual(result.custom_b, 'from-cli');
  // configContent (4) overrides cli (3) for custom_c
  assert.strictEqual(result.custom_c, 'from-content');
  // DEFAULT_SETTINGS (1) provides roleplay_user since no layer overrides it
  assert.strictEqual(result.roleplay_user, 'user');
});
