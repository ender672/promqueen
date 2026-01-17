#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const process = require('process');
const pqutils = require('./lib/pqutils.js');
const { renderTemplate } = require('./lib/rendertemplate.js');

function buildNameMap(promptRoles, userName) {
  const nameMap = Object.fromEntries(
    promptRoles.map(role => [role, role])
  );
  nameMap[userName] = 'user';
  return nameMap;
}

function addRoles(messages, userName) {
  const nameMap = buildNameMap(pqutils.PROMPT_ROLES, userName);
  messages.forEach(message => {
    message.role = nameMap[message.name] || 'assistant';
    if (pqutils.PROMPT_ROLES.includes(message.name)) {
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


function extractDecorators(message, config) {
  if (!message.name) return;

  const decoratorsMap = config.roleplay_prompt_decorators || {};
  let cleanName = message.name;
  let collectedDecorators = [];

  for (const [key, value] of Object.entries(decoratorsMap)) {
    const decoratorStr = `[${key}]`;
    if (cleanName.includes(decoratorStr)) {
      collectedDecorators.push(value);
      cleanName = cleanName.split(decoratorStr).join(' ');
    }
  }

  if (collectedDecorators.length > 0) {
    message.decorators = collectedDecorators;
    message.name = cleanName.replace(/\s+/g, ' ').trim();
  }
}

async function rpToPrompt(prompt, basePath = process.cwd()) {
  let { config: runtimeConfig, messages } = pqutils.parseConfigAndMessages(prompt);
  const config = pqutils.resolveConfig(runtimeConfig, basePath);
  const user = config.roleplay_user;

  messages.forEach(msg => extractDecorators(msg, config));

  addRoles(messages, user);

  // if last message is empty, the user is indicating which character to impersonate
  // if last message ends with a space, it's also an impersonation request but with a prefix
  let userRequestedCharacter = null;
  let hasPrefilledMessage = false;
  let characterDecorators = [];

  if (messages.length && messages[messages.length - 1].name) {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.decorators) {
      characterDecorators = lastMessage.decorators;
    }

    if (lastMessage.content === null || lastMessage.content === "") {
      userRequestedCharacter = lastMessage.name;
    } else if (typeof lastMessage.content === 'string' && lastMessage.content.endsWith(' ')) {
      userRequestedCharacter = lastMessage.name;
      hasPrefilledMessage = true;
    }
  }

  const templateVars = {
    char: userRequestedCharacter,
    user: user,
  }

  if (config.roleplay_combined_group_chat) {
    prefixWithNames(messages);
    namedMessagesAsRole(messages, 'assistant');
  } else if (userRequestedCharacter) {
    let prefilledMessage = null;
    if (hasPrefilledMessage) {
      prefilledMessage = messages.pop();
    } else if (!config.roleplay_prefix_with_name) {
      messages.pop();
    }

    if (config.roleplay_prefix_with_name) {
      prefixWithNames(messages);
    }

    let instructionTemplate = config.roleplay_impersonation_instruction;
    if (config.roleplay_char_impersonation_instruction && config.roleplay_char_impersonation_instruction[userRequestedCharacter]) {
      instructionTemplate = config.roleplay_char_impersonation_instruction[userRequestedCharacter];
    }

    if (instructionTemplate) {
      let instruction = renderTemplate(instructionTemplate, templateVars);
      if (characterDecorators.length > 0) {
        instruction += '\n' + characterDecorators.join('\n');
      }
      messages.push({ role: 'user', content: instruction });
    }

    if (prefilledMessage) {
      messages.push({ role: 'assistant', content: prefilledMessage.content });
    }
  } else if (messages.length && messages[messages.length - 1].name) {
    // we're going to ask the llm to complete a prefixed message
    messages.pop();
    messages[messages.length - 1].role = 'assistant';
  }

  messages = combineAdjacentMessagesWithSameRole(messages);

  let output = '---\n';
  output += yaml.dump(runtimeConfig);
  output += '---\n';
  output += serializeHistory(messages);
  return output;
}

function serializeHistory(messages) {
  let output = '';
  for (const [index, message] of messages.entries()) {
    if (index !== 0) {
      output += "\n\n";
    }
    output += `@${message.role}\n${message.content}`;
  }
  return output;
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

    const output = await rpToPrompt(prompt, process.cwd());
    process.stdout.write(output);
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
