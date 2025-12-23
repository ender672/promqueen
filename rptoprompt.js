#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const process = require('process');
const streamConsumers = require("node:stream/consumers");
const pqutils = require('./lib/pqutils.js');
const nunjucks = require('nunjucks');

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

function prefixWithNames(messages) {
  messages.forEach(message => {
    if (message.name) {
      message.content = `${message.name.toUpperCase()}\n${message.content}`;
    }
  });
}

function namedMessagesAsRole(messages, role) {
  messages.forEach(message => {
    if (message.name) {
      message.role = role;
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

async function rpToPrompt(prompt, outputStream = process.stdout, basePath = process.cwd()) {
  let { config: runtimeConfig, messages } = pqutils.parseConfigAndMessages(prompt);
  const config = pqutils.resolveConfig(runtimeConfig, basePath);
  const user = config.roleplay.user;

  addRoles(messages, user);

  // if last message is empty, the user is indicating which character to impersonate
  let userRequestedCharacter = null;
  if (messages.length && !messages.at(-1).content && messages.at(-1).name) {
    userRequestedCharacter = messages.at(-1).name;
  }

  const templateVars = {
    char: userRequestedCharacter,
    user: user,
  }

  if (config.roleplay.combined_group_chat) {
    prefixWithNames(messages);
    namedMessagesAsRole(messages, 'assistant');
  } else if (userRequestedCharacter && config.roleplay.chaos_monkey) {
    messages.pop();
    prefixWithNames(messages);
    namedMessagesAsRole(messages, 'user');
    if (config.roleplay.impersonation_instruction) {
      const instruction = nunjucks.renderString(config.roleplay.impersonation_instruction, templateVars);
      messages.push({ role: 'user', content: instruction });
    }    
  } else if (userRequestedCharacter) {
    if (config.roleplay.prefix_with_name) {
      prefixWithNames(messages);
    } else {
      messages.pop();
    }
    if (userRequestedCharacter === user && config.roleplay.user_impersonation_instruction) {
      const instruction = nunjucks.renderString(config.roleplay.user_impersonation_instruction, templateVars);
      messages.push({ role: 'user', content: instruction });
    } else if (config.roleplay.impersonation_instruction) {
      const instruction = nunjucks.renderString(config.roleplay.impersonation_instruction, templateVars);
      messages.push({ role: 'user', content: instruction });
    }
  } else if (messages.length && messages.at(-1).name) {
    // we're going to ask the llm to complete a prefixed message
    messages.pop();
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

  try {
    let prompt;

    if (filePath) {
      const resolvedPath = path.resolve(filePath);
      prompt = fs.readFileSync(resolvedPath, 'utf8');
    } else {
      prompt = fs.readFileSync(0, 'utf-8');
    }

    await rpToPrompt(prompt, process.stdout, process.cwd());
  } catch (error) {
    console.error('Error reading input:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  rpToPrompt
};
