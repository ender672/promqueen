const process = require('process');
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

function assignRole(name, roleplayUser) {
  if (name === null) return null;
  if (pqutils.PROMPT_ROLES.includes(name)) return name;
  if (name === roleplayUser) return 'user';
  return 'assistant';
}

function getIncompleteDecorator(name) {
  // Check if name contains an unclosed bracket: "Jim [partial"
  const openIdx = name.lastIndexOf('[');
  if (openIdx === -1) return null;
  // If there's a closing bracket after the last open bracket, it's complete
  if (name.indexOf(']', openIdx) !== -1) return null;
  const charName = name.substring(0, openIdx).trim();
  const partial = name.substring(openIdx + 1);
  return { charName, partial };
}

function getDecoratorAutocomplete(messages, partial, configDecoratorNames) {
  // Collect all decorators from history, most recent last
  const historyDecorators = [];
  for (const msg of messages) {
    if (msg.decorators) {
      for (const d of msg.decorators) {
        historyDecorators.push(d);
      }
    }
  }

  // Filter history decorators to those matching the partial prefix
  const historyMatches = historyDecorators.filter(d => d.startsWith(partial));

  // Most recently used history match wins
  if (historyMatches.length > 0) return historyMatches[historyMatches.length - 1];

  // Fall back to config decorator names
  const configMatch = configDecoratorNames.find(d => d.startsWith(partial));
  if (configMatch) return configMatch;

  return null;
}

function precompletionLint(messages, resolvedConfig, basePath = process.cwd()) {
  const user = resolvedConfig.roleplay_user;

  let output = '';

  // Check for incomplete decorator on the last message
  const last = messages.length > 0 ? messages.at(-1) : null;
  const incomplete = last && last.name ? getIncompleteDecorator(last.name) : null;

  if (incomplete) {
    const decoratorsMap = pqutils.loadDecorators(resolvedConfig, basePath);
    const configDecoratorNames = Object.keys(decoratorsMap);
    const match = getDecoratorAutocomplete(messages.slice(0, -1), incomplete.partial, configDecoratorNames);
    if (match) {
      output += match.substring(incomplete.partial.length) + ']\n';
    } else {
      output += ']\n';
    }
    // Fix the last message in place
    last.name = incomplete.charName;
    last.role = assignRole(last.name, user);
    last.decorators = [match || incomplete.partial];
    last.content = null;
  } else if (last && last.decorators && last.decorators.length > 0 && last.content === null) {
    // Complete decorator present, just add newline padding
    output += '\n';
    last.content = null;
  } else {
    const nameAutocomplete = getNameAutocomplete(messages, [user, ...pqutils.PROMPT_ROLES]);
    if (nameAutocomplete) {
      output += nameAutocomplete + '\n';
      // Fix the last message's name and role in place
      const last = messages.at(-1);
      last.name += nameAutocomplete;
      last.role = assignRole(last.name, user);
    } else if (messages && messages.length > 0) {
      const padding = getFinalMessagePadding(messages.at(-1).content);
      output += padding;
      if (padding) {
        messages.at(-1).content = (messages.at(-1).content || '') + padding;
      }
    }

    const nextSpeaker = pqutils.guessNextSpeaker(messages, user);
    if (nextSpeaker) {
      output += `@${nextSpeaker}\n`;
      messages.push({
        name: nextSpeaker,
        role: assignRole(nextSpeaker, user),
        content: null,
        decorators: []
      });
    }
  }

  return output;
}

module.exports = {
  precompletionLint,
  getNameAutocomplete,
  getFinalMessagePadding
};
