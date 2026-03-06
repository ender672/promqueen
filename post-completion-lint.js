const pqutils = require('./lib/pq-utils.js');

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

function postCompletionLint(messages, resolvedConfig) {
  const user = resolvedConfig.user;

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

module.exports = {
  postCompletionLint
};
