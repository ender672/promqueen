const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const os = require('os');

const DEFAULT_SETTINGS = {
  'roleplay': {
    'user': 'user',
    'impersonation_instruction': null,
    'combined_group_chat': false,
  },
  'api_call_headers': {},
  'api_call_props': {},
  'dot_config_loading': true,
};

function findDotConfigFile(basePath, filename) {
  let currentDir = path.resolve(basePath);
  const homeDir = os.homedir();

  while (true) {
    const configPath = path.join(currentDir, filename);

    try {
      if (fs.existsSync(configPath) && fs.statSync(configPath).isFile()) {
        return configPath;
      }
    } catch (e) {
      // Ignore errors (e.g., permission issues) and continue
    }

    if (currentDir === homeDir) {
      return null;
    }

    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

function resolveConfig(configContent, workingDirectory, cliConfig = {}) {
  let configFile = {};
  const shouldLoadConfig = configContent.dot_config_loading ?? DEFAULT_SETTINGS.dot_config_loading;

  if (shouldLoadConfig) {
    const configFilePath = findDotConfigFile(workingDirectory, '.chathistory');

    if (configFilePath) {
      const fileContents = fs.readFileSync(configFilePath, 'utf8');
      configFile = yaml.load(fileContents) || {};
    }
  }

  const configTmp = { ...configFile, ...cliConfig, ...configContent };
  let configProfile = {};

  if (configTmp.profile && configTmp.profiles && configTmp.profiles[configTmp.profile]) {
    configProfile = configTmp.profiles[configTmp.profile];
  }

  const config = {
    ...DEFAULT_SETTINGS, // 1. Base defaults
    ...configFile,      // 2. Settings from .chathistory file
    ...cliConfig,       // 3. Settings from CLI config file
    ...configProfile,   // 4. Settings from the active profile
    ...configContent    // 5. Runtime settings (highest priority)
  };

  return config;
}

function parseChatHistory(historyText) {
  const history = [];

  if (!historyText) {
    return history;
  }

  historyText = historyText.trimStart();

  // If it doesn't start with '@', treat the whole thing as a single user message
  if (!historyText.startsWith('@')) {
    return [{ name: 'user', content: historyText }];
  }

  const parts = historyText.split(/\n\n@(.+)/m);

  // The first one is special
  const firstMessage = parts.shift();
  const [, firstName, firstContent] = firstMessage.match(/^@([^\n]+)\n(.*)$/s);
  history.push({ name: firstName, content: firstContent });

  for (let i = 0; i < parts.length; i += 2) {
    // clean up leading newlines, which has an important side effect of detecting
    // if the last message has no newline after the character name.
    let content = parts[i + 1];
    if (content.startsWith("\n")) {
      content = content.slice(1);
    } else {
      content = null;
    }

    history.push({
      name: parts[i],
      content: content
    });
  }

  return history;
}

function parseConfigAndMessages(text) {
  const { config, messagesString } = parseConfigOnly(text);
  const messages = parseChatHistory(messagesString);
  return { config, messages };
}

function parseConfigOnly(text) {
  if (!text || !text.startsWith('---')) {
    throw new Error("Invalid input: Text must start with '---'");
  }

  const parts = text.split(/---\n/, 3);

  if (parts.length !== 3) {
    throw new Error("Invalid format: Expected YAML front matter separated by '---'");
  }

  const config = yaml.load(parts[1]);

  return { config, messagesString: parts[2] };
}

function getLogger(basePath) {
  const stdoutLogPath = `${basePath}_stdout.log`;
  const stderrLogPath = `${basePath}_stderr.log`;
  const logStdout = fs.createWriteStream(stdoutLogPath, { flags: 'a' });
  const logStderr = fs.createWriteStream(stderrLogPath, { flags: 'a' });
  return new console.Console({
    stdout: logStdout,
    stderr: logStderr,
  });
}

module.exports = {
  parseConfigAndMessages,
  parseConfigOnly,
  resolveConfig,
  getLogger
}
