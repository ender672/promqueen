#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const process = require('process');
const { marked } = require('marked');
const mustache = require('mustache');
const pqutils = require('./lib/pqutils.js');

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

function main() {
  const [, , filePath, templatePath] = process.argv;

  if (!filePath || !templatePath) {
    console.error('Usage: rptohtml.js <file.pqueen> <template.mustache>');
    process.exit(1);
  }

  const resolvedFilePath = path.resolve(filePath);
  const resolvedTemplatePath = path.resolve(templatePath);

  const promptText = fs.readFileSync(resolvedFilePath, 'utf8').replace(/\r\n/g, '\n');
  const templateText = fs.readFileSync(resolvedTemplatePath, 'utf8');
  const doc = pqutils.parseConfigAndMessages(promptText);
  const resolvedConfig = pqutils.resolveConfig(doc.config, path.dirname(resolvedFilePath));

  const output = rpToHtml(doc, resolvedConfig, templateText);
  process.stdout.write(output);
}

if (require.main === module) {
  main();
}

module.exports = { rpToHtml };
