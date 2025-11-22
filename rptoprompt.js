#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const process = require('process');
const streamConsumers = require("node:stream/consumers");
const nunjucks = require('nunjucks');
const pqutils = require('./lib/pqutils.js');

const PROMPT_ROLES = ['system', 'user', 'assistant'];

function buildNameMap(promptRoles, userName) {
  const nameMap = Object.fromEntries(
    promptRoles.map(role => [role, role])
  );
  nameMap[userName] = 'user';
  return nameMap;
}

function addRoles(messages, userName) {
  const nameMap = buildNameMap(PROMPT_ROLES, userName);
  messages.forEach(message => {
    message.role = nameMap[message.name] || 'assistant';
    if (PROMPT_ROLES.includes(message.name)) {
      delete message.name;
    }
  });
}

function renderTemplates(messages, basePath, vars) {
  const env = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(basePath)
  );
  messages.forEach(message => {
    message.content = env.renderString(message.content, vars);
  });
}

function prefixWithNames(messages) {
  messages.forEach(message => {
    if (message.name) {
      message.content = `${message.name.toUpperCase()}\n${message.content}`;
    }
  });
}

function namedMessagesAsAssistantRole(messages) {
  messages.forEach(message => {
    if (message.name) {
      message.role = 'assistant';
    }
  });
}

function combineAdjacentMessagesWithSameRole(messages) {
  return messages.reduce((acc, message) => {
    if (acc.length > 0 && acc[acc.length - 1].role === message.role) {
      acc[acc.length - 1].content += '\n\n' + message.content;
    } else {
      acc.push(message);
    }
    return acc;
  }, []);
}

async function rpToPrompt(inputStream = process.stdin, outputStream = process.stdout, basePath = process.cwd()) {
  const fileContent = await streamConsumers.text(inputStream);
  let { config: runtimeConfig, history: messages } = pqutils.parseDataAndChatHistory(fileContent);
  const config = pqutils.resolveConfig(runtimeConfig, basePath);
  const user = config.user;

  // if last message is empty, the user is indicating which character to impersonate
  let userRequestedCharacter = null;
  if (messages.length && !messages.at(-1).content) {
    userRequestedCharacter = messages.pop().name;
  }

  const templateVars = {
    user: user,
    char: config.char,
  }
  const templatePath = path.dirname(basePath);
  renderTemplates(messages, templatePath, templateVars);
  addRoles(messages, user);

  if (config.combined_group_chat) {
    if (userRequestedCharacter) {
      messages.push({ name: userRequestedCharacter, content: '' });
    }
    prefixWithNames(messages);
    namedMessagesAsAssistantRole(messages);
  } else if (userRequestedCharacter) {
    if (config.impersonation_instruction) {
      const instruction = nunjucks.renderString(config.impersonation_instruction, { char: userRequestedCharacter });
      messages.push({ role: 'user', content: instruction });
    }
  } else if (messages.length && messages.at(-1).name) {
    messages.at(-1).role = 'assistant';
  }

  messages = combineAdjacentMessagesWithSameRole(messages);

  outputStream.write('---\n');
  outputStream.write(yaml.dump(runtimeConfig));
  outputStream.write('---\n');
  serializeHistory(messages, outputStream);
}

function serializeHistory(messages, outputStream) {
  for (const [index, message] of messages.entries()) {
    if (index !== 0) {
      outputStream.write("\n\n");
    }
    outputStream.write(`@${message.role}\n${message.content}`);
  }
}

async function main() {
  const [, , filePath] = process.argv;
  if (!filePath) {
    console.error('Error: Please provide a file path as an argument.');
    console.error('Usage: node rptoprompt.js <path/to/your/file.txt>');
    process.exit(1);
  }

  try {
    const resolvedPath = path.resolve(filePath);
    const inputStream = fs.createReadStream(resolvedPath, 'utf8');
    await rpToPrompt(inputStream, process.stdout, resolvedPath);
  } catch (error) {
    console.error('Error reading file:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  rpToPrompt
};
