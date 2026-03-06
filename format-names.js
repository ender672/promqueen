const pqutils = require('./lib/pq-utils.js');

function prefixWithNames(messages) {
  messages.forEach(message => {
    if (message.name && !pqutils.PROMPT_ROLES.includes(message.name)) {
      message.content = `${message.name.toUpperCase()}\n${message.content}`;
    }
  });
}

function namedMessagesAsRole(messages, role) {
  messages.forEach(message => {
    if (message.name && !pqutils.PROMPT_ROLES.includes(message.name)) {
      message.role = role;
    }
  });
}

function formatNames(messages, resolvedConfig) {
  messages = messages.map(m => ({ ...m }));

  if (resolvedConfig.roleplay_combined_group_chat) {
    prefixWithNames(messages);
    namedMessagesAsRole(messages, 'assistant');
  } else if (resolvedConfig.roleplay_prefix_with_name) {
    prefixWithNames(messages);
  }

  return messages;
}

module.exports = {
  formatNames
};
