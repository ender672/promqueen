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
  if (lastContent === null || lastContent.trim() === '') {
    return null;
  }

  if (lastContent.endsWith(' ')) {
    return null;
  }

  // Iterate backwards through the history
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    const rolesToExclude = [...PROMPT_ROLES, userName, lastSpeaker];

    if (!rolesToExclude.includes(message.name)) {
      return message.name;
    }
  }

  if (lastSpeaker !== userName) {
    return userName;
  }

  return 'assistant';
}

function getNameAutocomplete(history, extraNames) {
  if (!history || history.length === 0) {
    return null;
  }

  // Autocomplete only works if the last message is empty. No newline.
  if (history[history.length - 1].content !== "") {
    return null;
  }

  const nameCandidates = history.map(x => x.name).reverse();
  const latestSpeaker = nameCandidates.shift(); // .shift() removes the first element

  // First, see if we have an exact name match in our history.
  // .some() is a clean way to check if any element matches
  if (nameCandidates.some(candidate => candidate === latestSpeaker)) {
    return null;
  }

  // Try to find a partial match, including extra names
  const augmentedCandidates = [...nameCandidates, ...extraNames];
  for (const candidate of augmentedCandidates) {
    if (candidate.startsWith(latestSpeaker)) {
      // Return the part of the string that's missing
      return candidate.substring(latestSpeaker.length);
    }
  }

  return null;
}

function getFinalMessagePadding(message) {
  // If the final message is null, we need a newline after the name.
  if (message === null) {
    return "\n";
  }

  // If the final message is an empty string, it's ready to be filled.
  if (message === '') {
    return null;
  }

  // If the final message ends with a space, we want to continue from there.
  if (message.endsWith(' ')) {
    return null;
  }

  // If the final message is none of the above and ends with two newlines,
  // we are ready for the next, unknown speaker.
  if (message.endsWith('\n\n')) {
    return null;
  }

  // If the final message is none of the above and ends with a single newline,
  // add an extra newline and we're ready for the next, unknown speaker.
  if (message.endsWith('\n')) {
    return '\n';
  }

  // If we get this far, the final message has content, but no newlines. We
  // need two newlines to be ready for the next, unknown speaker.
  return '\n\n';
}

function main() {
    const [,, filePath] = process.argv;

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

    const nameAutocomplete = getNameAutocomplete(history, [user] + PROMPT_ROLES);
    if (nameAutocomplete) {
        process.stdout.write(nameAutocomplete);
    }

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
