const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const os = require('os');

const DEFAULT_SETTINGS = {
  'roleplay_user': 'user',
  'roleplay_combined_group_chat': false,
  'api_call_headers': {},
  'api_call_props': {},
  'dot_config_loading': true,
};

const PROMPT_ROLES = ['system', 'user', 'assistant'];

function assignRoles(messages, roleplayUser) {
  for (const message of messages) {
    if (message.name === null) {
      message.role = null;
    } else if (PROMPT_ROLES.includes(message.name)) {
      message.role = message.name;
    } else if (message.name === roleplayUser) {
      message.role = 'user';
    } else {
      message.role = 'assistant';
    }
  }
}

function guessNextSpeaker(history, userName) {
  if (history.length === 0) {
    return null;
  }

  const lastMessage = history[history.length - 1];
  const lastSpeaker = lastMessage.name;
  const lastContent = lastMessage.content;

  // Use trim() to check if the content is just whitespace
  if (lastContent === null || lastContent.trim() === '') {
    return null;
  }

  if (lastContent.endsWith(' ')) {
    return null;
  }

  // Look for the last time the current speaker spoke and use the person who followed them.
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i].name === lastSpeaker) {
      if (i + 1 < history.length - 1) {
        const follower = history[i + 1].name;
        if (follower !== lastSpeaker) {
          return follower;
        }
      }
    }
  }

  // Iterate backwards through the history
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    const rolesToExclude = [...PROMPT_ROLES, userName, lastSpeaker];

    if (!rolesToExclude.includes(message.name)) {
      return message.name;
    }
  }

  if (lastSpeaker !== userName) {
    return userName;
  }

  return 'assistant';
}

function findDotConfigFile(filename) {
  const homeDir = os.homedir();
  const configPath = path.join(homeDir, filename);

  try {
    if (fs.existsSync(configPath) && fs.statSync(configPath).isFile()) {
      return configPath;
    }
  } catch {
    // Ignore errors
  }

  return null;
}

function loadDotConfig() {
  const configFilePath = findDotConfigFile('.promqueen');
  if (!configFilePath) return {};
  const fileContents = fs.readFileSync(configFilePath, 'utf8');
  return yaml.load(fileContents) || {};
}

function expandEnvVars(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      result[key] = value.replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced, plain) => {
        const varName = braced || plain;
        const envValue = process.env[varName];
        if (envValue === undefined) {
          throw new Error(`Environment variable ${varName} is not set (referenced in header '${key}')`);
        }
        return envValue;
      });
    } else {
      result[key] = value;
    }
  }
  return result;
}

function resolveConfig(configContent, workingDirectory, cliConfig = {}) {
  let configFile = {};
  const shouldLoadConfig = configContent.dot_config_loading ?? DEFAULT_SETTINGS.dot_config_loading;

  if (shouldLoadConfig) {
    configFile = loadDotConfig();
  }

  const configTmp = { ...configFile, ...cliConfig, ...configContent };
  let configProfile = {};

  if (configTmp.profile && configTmp.profiles && configTmp.profiles[configTmp.profile]) {
    configProfile = configTmp.profiles[configTmp.profile];
  }

  const config = {
    ...DEFAULT_SETTINGS, // 1. Base defaults
    ...configFile,      // 2. Settings from .promqueen file
    ...cliConfig,       // 3. Settings from CLI config file
    ...configProfile,   // 4. Settings from the active profile
    ...configContent    // 5. Runtime settings (highest priority)
  };

  config.api_call_headers = expandEnvVars(config.api_call_headers);

  return config;
}

function parseNameAndDecorators(rawName) {
  const decorators = [];
  let name = rawName;

  const bracketRegex = /\[([^\]]+)\]/g;
  let match;
  while ((match = bracketRegex.exec(rawName)) !== null) {
    decorators.push(match[1]);
  }

  if (decorators.length > 0) {
    name = rawName.replace(bracketRegex, ' ').replace(/\s+/g, ' ').trim();
  }

  return { name, decorators };
}

function buildMessage(rawName, content) {
  if (rawName === null) {
    return { name: null, content, decorators: [] };
  }
  const { name, decorators } = parseNameAndDecorators(rawName);
  return { name, content, decorators };
}

function parseMessages(historyText) {
  const history = [];

  if (!historyText) {
    return history;
  }

  // Strip leading newlines only, not spaces — leading spaces before @ should
  // prevent it from being recognized as a role marker.
  historyText = historyText.replace(/^\n+/, '');

  // If it doesn't start with '@', treat the whole thing as a single message
  if (!historyText.startsWith('@')) {
    return [{ name: null, content: historyText, decorators: [] }];
  }

  const parts = historyText.split(/\n\n@(.+)/m);

  // The first one is special
  const firstMessage = parts.shift();
  const firstMatch = firstMessage.match(/^@([^\n]+)(?:\n(.*))?$/s);
  if (firstMatch) {
    const [, firstName, firstContent] = firstMatch;
    history.push(buildMessage(firstName, firstContent ?? null));
  }

  for (let i = 0; i < parts.length; i += 2) {
    // clean up leading newlines, which has an important side effect of detecting
    // if the last message has no newline after the character name.
    let content = parts[i + 1];
    if (content !== undefined && content !== "") {
      if (content.startsWith("\n")) {
        content = content.slice(1);
      } else {
        content = null;
      }
    } else {
      content = null;
    }

    history.push(buildMessage(parts[i], content));
  }

  return history;
}

function parseConfigAndMessages(text) {
  const { config, messagesString } = parseConfigOnly(text);
  const messages = parseMessages(messagesString);
  assignRoles(messages, config.roleplay_user || DEFAULT_SETTINGS.roleplay_user);
  return { config, messages };
}

function parseConfigOnly(text) {
  if (!text || !text.startsWith('---')) {
    throw new Error("Invalid input: Text must start with '---'");
  }

  const splitIndex = text.indexOf('\n---', 3);

  if (splitIndex === -1) {
    throw new Error("Invalid format: Expected YAML front matter separating '---' not found");
  }

  const configString = text.slice(3, splitIndex);

  let messageStart = splitIndex + 4; // Skip matching `\n---`

  if (text[messageStart] === '\n') {
    messageStart++;
  }

  const config = yaml.load(configString) || {};

  return { config, messagesString: text.slice(messageStart) };
}

function serializeMessages(messages) {
  return messages.map((m, i) => {
    const prefix = i > 0 ? '\n\n' : '';
    if (m.name === null) return prefix + (m.content || '');
    let fullName = m.name;
    if (m.decorators && m.decorators.length > 0) {
      fullName += ' ' + m.decorators.map(d => `[${d}]`).join(' ');
    }
    if (m.content === null) return prefix + '@' + fullName;
    return prefix + '@' + fullName + '\n' + m.content;
  }).join('');
}

function serializeDocument(config, messages) {
  let output = '---\n';
  output += yaml.dump(config);
  output += '---\n';
  output += serializeMessages(messages);
  return output;
}

function loadDecorators(config, basePath) {
  const decoratorsPath = config.decorators;
  if (!decoratorsPath) return {};
  const resolved = path.isAbsolute(decoratorsPath) ? decoratorsPath : path.resolve(basePath, decoratorsPath);
  const contents = fs.readFileSync(resolved, 'utf8');
  return yaml.load(contents) || {};
}

module.exports = {
  parseMessages,
  serializeMessages,
  serializeDocument,
  parseConfigAndMessages,
  parseConfigOnly,
  resolveConfig,
  loadDotConfig,
  loadDecorators,
  assignRoles,
  PROMPT_ROLES,
  guessNextSpeaker
}
