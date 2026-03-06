const { marked } = require('marked');
const mustache = require('mustache');

marked.use({ breaks: false });

function unescapePipelineSequences(text) {
  return text
    .replace(/\\{{/g, '{{')
    .replace(/\\@/g, '@')
    .replace(/\\{%/g, '{%');
}

function getRoleFlags(message) {
  return {
    isUser: message.role === 'user',
    isAssistant: message.role === 'assistant',
    isSystem: message.role === 'system',
  };
}

function rpToHtml({ messages }, resolvedConfig, templateText) {
  const processedMessages = [];
  let seenAssistant = false;
  for (const message of messages) {
    if (message.content === null) continue;

    const unescaped = unescapePipelineSequences(message.content);
    const html = marked.parse(unescaped);
    const flags = getRoleFlags(message);

    if (flags.isAssistant) seenAssistant = true;

    processedMessages.push({
      name: message.name,
      content: html,
      beforeFirstAssistant: !seenAssistant,
      ...flags,
    });
  }

  const data = {
    config: resolvedConfig,
    messages: processedMessages,
  };

  return mustache.render(templateText, data);
}

module.exports = { rpToHtml };
