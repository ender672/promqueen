#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const process = require('process');
const pqutils = require('./lib/pqutils.js');

const PROMPT_ROLES = ['system', 'user', 'assistant'];

function guessNextSpeaker(history, userName) {
  if (!history || history.length === 0) {
    return null;
  }

  const lastMessage = history[history.length - 1];
  const lastSpeaker = lastMessage.name;
  const lastContent = lastMessage.content;

  // Use trim() to check if the content is just whitespace
  if (lastContent.trim() === '') {
    return null;
  }

  if (lastSpeaker !== userName) {
    return userName;
  }

  // Iterate backwards through the history
  const rolesToExclude = [...PROMPT_ROLES, lastSpeaker];
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];

    if (!rolesToExclude.includes(message.name)) {
      return message.name;
    }
  }

  return 'assistant';
}

function getFinalMessagePadding(message) {
  // If the final message is null, don't do anything.
  if (message === null) {
    return null;
  }

  // If the final message is an empty string, don't do anything.
  if (message === '') {
    return null;
  }

  // If the final message is none of the above and ends with two newlines,
  // we are ready to add the next speaker.
  if (message.endsWith('\n\n')) {
    return null;
  }

  // If the final message is none of the above and ends with a single newline,
  // add an extra newline and we're ready to add the next speaker.
  if (message.endsWith('\n')) {
    return '\n';
  }

  // If we get this far, the final message has content, but no newlines. We
  // need two newlines to be ready to add the next speaker.
  return '\n\n';
}

function main() {
  const [, , filePath] = process.argv;

  if (!filePath) {
    console.error('Error: Please provide a file path as an argument.');
    console.log('Usage: node parseFile.js <path/to/your/file.txt>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);
  const fileContent = fs.readFileSync(resolvedPath, 'utf8');

  const { config: runtimeConfig, history } = pqutils.parseDataAndChatHistory(fileContent);
  const fullConfig = pqutils.resolveConfig(runtimeConfig, __dirname);
  const user = fullConfig.user;

  if (history) {
    const finalPadding = getFinalMessagePadding(history.at(-1).content)
    if (finalPadding) {
      process.stdout.write(finalPadding);
    }
  }

  const nextSpeaker = guessNextSpeaker(history, user);
  if (nextSpeaker) {
    process.stdout.write(`@${nextSpeaker}\n`);
  }
}

main();
