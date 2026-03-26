const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const os = require('os');

const DEFAULTS_PATH = path.join(__dirname, '..', 'defaults.yaml');
const DEFAULT_SETTINGS = yaml.load(
  fs.readFileSync(DEFAULTS_PATH, 'utf8')
);
const DOTCONFIG_TEMPLATE_PATH = path.join(__dirname, '..', 'dotconfig-template.yaml');

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

function nextSpeakerFromNames(names, userName) {
  if (names.length === 0) return null;
  const lastSpeaker = names[names.length - 1];

  // Look for the last time the current speaker spoke and use the person who followed them.
  for (let i = names.length - 2; i >= 0; i--) {
    if (names[i] === lastSpeaker) {
      if (i + 1 < names.length - 1) {
        const follower = names[i + 1];
        if (follower !== lastSpeaker) {
          return follower;
        }
      }
    }
  }

  // Find the most recent character name (excluding standard roles, userName, lastSpeaker)
  const rolesToExclude = [...PROMPT_ROLES, userName, lastSpeaker];
  for (let i = names.length - 1; i >= 0; i--) {
    if (!rolesToExclude.includes(names[i])) {
      return names[i];
    }
  }

  if (lastSpeaker !== userName && lastSpeaker !== 'user') {
    // If the history only uses standard roles, stick with standard roles.
    const hasCharacterNames = names.some(n => !PROMPT_ROLES.includes(n));
    return hasCharacterNames ? userName : 'user';
  }

  return 'assistant';
}

function guessNextSpeaker(history, userName) {
  if (history.length === 0) {
    return null;
  }

  const lastMessage = history[history.length - 1];
  const lastContent = lastMessage.content;

  // Use trim() to check if the content is just whitespace
  if (lastContent === null || lastContent.trim() === '') {
    return null;
  }

  if (lastContent.endsWith(' ')) {
    return null;
  }

  return nextSpeakerFromNames(history.map(m => m.name), userName);
}

function getConfigDir(overrideDir) {
  return overrideDir || path.join(os.homedir(), '.promqueen');
}

function getConfigFilePath(overrideDir) {
  return path.join(getConfigDir(overrideDir), 'config.yaml');
}

function getTemplateDir(overrideDir) {
  return path.join(getConfigDir(overrideDir), 'templates');
}

function ensureConfigDir(overrideDir) {
  const dir = getConfigDir(overrideDir);
  if (fs.existsSync(dir) && fs.statSync(dir).isFile()) {
    console.error(`Error: ${dir} is a file from an old promqueen version. Delete it and ~/.promqueen-templates/ — the new layout is ~/.promqueen/config.yaml and ~/.promqueen/templates/.`);
    process.exit(1);
  }
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const configPath = getConfigFilePath(overrideDir);
  if (!fs.existsSync(configPath)) {
    fs.copyFileSync(DOTCONFIG_TEMPLATE_PATH, configPath);
  }
  const templateDir = getTemplateDir(overrideDir);
  if (!fs.existsSync(templateDir)) {
    fs.mkdirSync(templateDir, { recursive: true });
    const src = path.join(__dirname, '..', 'templates', 'charcard-prompt-complete.pqueen.jinja');
    const dest = path.join(templateDir, 'standard.pqueen.jinja');
    fs.copyFileSync(src, dest);
  }
}

function loadDotConfig(overrideDir) {
  const configPath = getConfigFilePath(overrideDir);
  if (!fs.existsSync(configPath)) return {};
  const fileContents = fs.readFileSync(configPath, 'utf8');
  return yaml.load(fileContents) || {};
}

// Update specific keys in the dotconfig file, preserving comments and structure.
// For each key in `updates`, if a line matching `# key:` or `key:` exists, it is
// replaced (and uncommented). Otherwise the key is appended at the end.
function updateDotConfig(updates, overrideDir) {
  const configPath = getConfigFilePath(overrideDir);
  if (!fs.existsSync(configPath)) {
    const dir = getConfigDir(overrideDir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(DOTCONFIG_TEMPLATE_PATH, configPath);
  }

  let text = fs.readFileSync(configPath, 'utf8');

  for (const [key, value] of Object.entries(updates)) {
    const replacement = yaml.dump({ [key]: value }, { lineWidth: 120, noRefs: true }).trimEnd();
    // Try commented-out line first, then active line.
    const commentedRe = new RegExp(`^# ${key}:.*$`, 'm');
    const activeRe = new RegExp(`^${key}:.*$`, 'm');

    if (commentedRe.test(text)) {
      text = text.replace(commentedRe, replacement);
    } else if (activeRe.test(text)) {
      text = text.replace(activeRe, replacement);
    } else {
      text = text.trimEnd() + '\n' + replacement + '\n';
    }
  }

  fs.writeFileSync(configPath, text, 'utf8');
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

function deepMerge(...sources) {
  const result = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (value === null) {
        delete result[key];
      } else if (typeof value === 'object' && !Array.isArray(value)
          && typeof result[key] === 'object' && !Array.isArray(result[key])) {
        result[key] = deepMerge(result[key], value);
      } else {
        result[key] = value;
      }
    }
  }
  return result;
}

function resolveConfig(configContent, workingDirectory, cliConfig = {}, configDir) {
  let configFile = {};
  const shouldLoadConfig = configContent.dot_config_loading ?? DEFAULT_SETTINGS.dot_config_loading;

  if (shouldLoadConfig) {
    configFile = loadDotConfig(configDir);
  }

  const config = deepMerge(
    DEFAULT_SETTINGS, // 1. Base defaults
    configFile,       // 2. Settings from ~/.promqueen/config.yaml
    cliConfig,        // 3. Settings from CLI config file
    configContent     // 4. Runtime settings (highest priority)
  );

  if (config.connection) {
    if (!config.connection_profiles || !config.connection_profiles[config.connection]) {
      throw new Error(`Connection profile '${config.connection}' not found in connection_profiles`);
    }
  }

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
    let fullName = m.name || m.role || 'unknown';
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

function getConnectionProfile(config) {
  if (!config.connection) {
    throw new Error('No connection profile selected. Set "connection" in your config or frontmatter.');
  }
  return config.connection_profiles[config.connection];
}

// Generate a fully-documented ~/.promqueen/config.yaml file.
// User's active values go at the top, then the template as a commented reference.
function generateDotConfigText(config) {
  config = config || {};

  const dumpOpts = { lineWidth: 120, noRefs: true };
  const parts = [];

  // Active config values at the top.
  if (Object.keys(config).length > 0) {
    parts.push(yaml.dump(config, dumpOpts).trimEnd());
    parts.push('');
  }

  // Commented-out reference below.
  const template = fs.readFileSync(DOTCONFIG_TEMPLATE_PATH, 'utf8');
  parts.push(template.trimEnd());
  parts.push('');

  return parts.join('\n');
}

module.exports = {
  parseMessages,
  serializeMessages,
  serializeDocument,
  parseConfigAndMessages,
  parseConfigOnly,
  resolveConfig,
  getConnectionProfile,
  expandEnvVars,
  ensureConfigDir,
  getConfigDir,
  getTemplateDir,
  loadDotConfig,
  updateDotConfig,
  loadDecorators,
  assignRoles,
  PROMPT_ROLES,
  guessNextSpeaker,
  nextSpeakerFromNames,
  generateDotConfigText
}
