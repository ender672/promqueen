const process = require('process');
const pqutils = require('./lib/pq-utils.js');
const { expandCBS } = require('./lib/render-template.js');

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

function appendOrPushUserMessage(messages, content) {
  const last = messages.length ? messages[messages.length - 1] : null;
  if (last && last.role === 'user') {
    last.content = (last.content || '') + '\n\n' + content;
  } else {
    messages.push({ role: 'user', content });
  }
}

function injectInstructions(messages, resolvedConfig, basePath = process.cwd()) {
  messages = messages.map(m => ({ ...m }));
  const user = resolvedConfig.roleplay_user;

  // 1. Resolve decorators
  const decoratorsMap = pqutils.loadDecorators(resolvedConfig, basePath);
  messages.forEach(msg => resolveDecorators(msg, decoratorsMap));

  // 2. Inject decorator content as user instructions before the decorated message
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.decorators && msg.decorators.length > 0) {
      const instruction = msg.decorators.join('\n');
      messages.splice(i, 0, { role: 'user', content: instruction });
      delete msg.decorators;
      i++;
    }
  }

  // 3. Handle impersonation / next-speaker signal
  // In combined group chat mode, the empty last message is kept for name prefixing
  if (resolvedConfig.roleplay_combined_group_chat) {
    return messages;
  }

  const lastMsg = messages.length ? messages[messages.length - 1] : null;
  const lastIsCharacter = lastMsg && !pqutils.PROMPT_ROLES.includes(lastMsg.name);

  if (!lastIsCharacter) return messages;

  const templateVars = { char: null, user };

  if (lastMsg.content === null || lastMsg.content === '') {
    // Empty content = next speaker / impersonation request
    templateVars.char = lastMsg.name;
    messages.pop();

    let instructionTemplate = resolvedConfig.roleplay_impersonation_instruction;
    if (resolvedConfig.roleplay_char_impersonation_instruction &&
        resolvedConfig.roleplay_char_impersonation_instruction[lastMsg.name]) {
      instructionTemplate = resolvedConfig.roleplay_char_impersonation_instruction[lastMsg.name];
    }

    if (instructionTemplate) {
      const instruction = expandCBS(instructionTemplate, templateVars);
      appendOrPushUserMessage(messages, instruction);
    }
  } else if (typeof lastMsg.content === 'string' && lastMsg.content.endsWith(' ')) {
    // Trailing space = impersonation with prefill
    templateVars.char = lastMsg.name;
    const prefill = messages.pop();

    let instructionTemplate = resolvedConfig.roleplay_impersonation_instruction;
    if (resolvedConfig.roleplay_char_impersonation_instruction &&
        resolvedConfig.roleplay_char_impersonation_instruction[lastMsg.name]) {
      instructionTemplate = resolvedConfig.roleplay_char_impersonation_instruction[lastMsg.name];
    }

    if (instructionTemplate) {
      const instruction = expandCBS(instructionTemplate, templateVars);
      appendOrPushUserMessage(messages, instruction);
    }

    messages.push({ role: 'assistant', content: prefill.content });
  } else {
    // Normal content on last character = complete from previous message
    messages.pop();
    messages[messages.length - 1].role = 'assistant';
  }

  return messages;
}

module.exports = {
  injectInstructions
};
