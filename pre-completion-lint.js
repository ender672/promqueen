const pqutils = require('./lib/pq-utils.js');

function getNameAutocomplete(history, extraNames) {
  if (history.length === 0) {
    return null;
  }

  // Autocomplete only works if the last message is empty. No newline.
  if (history[history.length - 1].content !== "" && history[history.length - 1].content !== null) {
    return null;
  }

  const nameCandidates = history.map(x => x.name).reverse();
  const latestSpeaker = nameCandidates.shift(); // .shift() removes the first element

  // First, see if we have an exact name match in our history or extra names.
  const augmentedCandidates = [...nameCandidates, ...extraNames];
  if (augmentedCandidates.some(candidate => candidate === latestSpeaker)) {
    return null;
  }
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
    return '';
  }

  // If the final message ends with a space, we want to continue from there.
  if (message.endsWith(' ')) {
    return '';
  }

  // If the final message is none of the above and ends with two newlines,
  // we are ready for the next, unknown speaker.
  if (message.endsWith('\n\n')) {
    return '';
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

function precompletionLint(messages, resolvedConfig) {
  const user = resolvedConfig.roleplay_user;

  let output = '';

  const nameAutocomplete = getNameAutocomplete(messages, [user, ...pqutils.PROMPT_ROLES]);
  if (nameAutocomplete) {
    output += nameAutocomplete + '\n';
  } else if (messages && messages.length > 0) {
    output += getFinalMessagePadding(messages.at(-1).content);
  }

  const nextSpeaker = pqutils.guessNextSpeaker(messages, user);
  if (nextSpeaker) {
    output += `@${nextSpeaker}\n`;
  }

  return output;
}

module.exports = {
  precompletionLint,
  getNameAutocomplete,
  getFinalMessagePadding
};
