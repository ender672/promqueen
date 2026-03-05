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

function resolveDecorators(message, decoratorsMap) {
  if (!message.decorators || message.decorators.length === 0) return;

  const resolved = [];
  for (const tag of message.decorators) {
    if (decoratorsMap[tag]) {
      resolved.push(decoratorsMap[tag]);
    }
  }
  message.decorators = resolved;
}

function rpToPrompt(messages, resolvedConfig, basePath = process.cwd()) {
  messages = messages.map(m => ({ ...m }));
  const user = resolvedConfig.roleplay_user;

  const decoratorsMap = pqutils.loadDecorators(resolvedConfig, basePath);
  messages.forEach(msg => resolveDecorators(msg, decoratorsMap));

  addRoles(messages, user);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    // If we have decorators but no name, it means we have a standard role (like assistant)
    // with decorators. We need to inject these as instructions.
    if (msg.decorators && msg.decorators.length > 0 && !msg.name) {
      const instruction = msg.decorators.join('\n');
      messages.splice(i, 0, { role: 'user', content: instruction });
      delete msg.decorators;
      i++; // Skip the message we just inserted (since we spliced at current index)
    }
  }

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

  if (resolvedConfig.roleplay_combined_group_chat) {
    prefixWithNames(messages);
    namedMessagesAsRole(messages, 'assistant');
  } else if (userRequestedCharacter) {
    let prefilledMessage = null;
    if (hasPrefilledMessage) {
      prefilledMessage = messages.pop();
    } else if (!resolvedConfig.roleplay_prefix_with_name) {
      messages.pop();
    }

    if (resolvedConfig.roleplay_prefix_with_name) {
      prefixWithNames(messages);
    }

    let instructionTemplate = resolvedConfig.roleplay_impersonation_instruction;
    if (resolvedConfig.roleplay_char_impersonation_instruction && resolvedConfig.roleplay_char_impersonation_instruction[userRequestedCharacter]) {
      instructionTemplate = resolvedConfig.roleplay_char_impersonation_instruction[userRequestedCharacter];
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

  return messages;
}

function serializeHistory(messages) {
  return messages.map((message, index) => {
    const prefix = index > 0 ? '\n\n' : '';
    return `${prefix}@${message.role}\n${message.content}`;
  }).join('');
}

function main() {
  const [, , filePath] = process.argv;

  try {
    let prompt;

    if (filePath) {
      const resolvedPath = path.resolve(filePath);
      prompt = fs.readFileSync(resolvedPath, 'utf8').replace(/\r\n/g, '\n');
    } else {
      prompt = fs.readFileSync(0, 'utf-8').replace(/\r\n/g, '\n');
    }

    const basePath = filePath ? path.dirname(path.resolve(filePath)) : process.cwd();
    const { config: runtimeConfig, messages } = pqutils.parseConfigAndMessages(prompt);
    const resolvedConfig = pqutils.resolveConfig(runtimeConfig, basePath);
    const resultMessages = rpToPrompt(messages, resolvedConfig, basePath);

    let output = '---\n';
    output += yaml.dump(runtimeConfig);
    output += '---\n';
    output += serializeHistory(resultMessages);
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
