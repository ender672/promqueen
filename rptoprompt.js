const process = require('process');
const pqutils = require('./lib/pqutils.js');
const { renderTemplate } = require('./lib/rendertemplate.js');

function prefixWithNames(messages) {
  messages.forEach(message => {
    if (!pqutils.PROMPT_ROLES.includes(message.name)) {
      message.content = `${message.name.toUpperCase()}\n${message.content}`;
    }
  });
}

function namedMessagesAsRole(messages, role) {
  messages.forEach(message => {
    if (!pqutils.PROMPT_ROLES.includes(message.name)) {
      message.role = role;
    }
  });
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

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    // If we have decorators on a standard role (like assistant),
    // we need to inject these as instructions.
    if (msg.decorators && msg.decorators.length > 0 && pqutils.PROMPT_ROLES.includes(msg.name)) {
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

  const lastMsg = messages.length ? messages[messages.length - 1] : null;
  const lastIsCharacter = lastMsg && !pqutils.PROMPT_ROLES.includes(lastMsg.name);

  if (lastIsCharacter) {
    if (lastMsg.decorators) {
      characterDecorators = lastMsg.decorators;
    }

    if (lastMsg.content === null || lastMsg.content === "") {
      userRequestedCharacter = lastMsg.name;
    } else if (typeof lastMsg.content === 'string' && lastMsg.content.endsWith(' ')) {
      userRequestedCharacter = lastMsg.name;
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
  } else if (lastIsCharacter) {
    // we're going to ask the llm to complete a prefixed message
    messages.pop();
    messages[messages.length - 1].role = 'assistant';
  }

  return messages;
}

module.exports = {
  rpToPrompt
};
