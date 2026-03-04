#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const process = require('process');
const pqutils = require('./lib/pqutils.js');



function getFinalMessagePadding(message) {
  // If the final message is null, don't do anything.
  if (message === null) {
    return '';
  }

  // If the final message is an empty string, don't do anything.
  if (message === '') {
    return '';
  }

  // If the final message is none of the above and ends with two newlines,
  // we are ready to add the next speaker.
  if (message.endsWith('\n\n')) {
    return '';
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

function postCompletionLint(fileContent, baseDir) {
  const { config: runtimeConfig, messages } = pqutils.parseConfigAndMessages(fileContent);
  const fullConfig = pqutils.resolveConfig(runtimeConfig, baseDir);
  const user = fullConfig.user;

  let output = '';

  if (messages) {
    output += getFinalMessagePadding(messages.at(-1).content);
  }

  const nextSpeaker = pqutils.guessNextSpeaker(messages, user);
  if (nextSpeaker) {
    output += `@${nextSpeaker}\n`;
  }

  return output;
}

function main() {
  const [, , filePath] = process.argv;

  if (!filePath) {
    console.error('Error: Please provide a file path as an argument.');
    console.log('Usage: node parseFile.js <path/to/your/file.txt>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);
  const fileContent = fs.readFileSync(resolvedPath, 'utf8').replace(/\r\n/g, '\n');

  const output = postCompletionLint(fileContent, process.cwd());
  process.stdout.write(output);
}

if (require.main === module) {
  main();
}

module.exports = {
  postCompletionLint
};
