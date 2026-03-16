const path = require('path');
const { serializeMessages, PROMPT_ROLES } = require('./lib/pq-utils');
const { buildTemplateContext } = require('./lib/render-template');

function splitCBSArgs(argsStr) {
  const parts = [];
  let current = '';
  for (let i = 0; i < argsStr.length; i++) {
    if (argsStr[i] === '\\' && i + 1 < argsStr.length && argsStr[i + 1] === ',') {
      current += ',';
      i++;
    } else if (argsStr[i] === ',') {
      parts.push(current);
      current = '';
    } else {
      current += argsStr[i];
    }
  }
  parts.push(current);
  return parts;
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function expandCBS(text, templateContext, promptText) {
  return text.replace(/\{\{(.*?)\}\}/g, (match, inner) => {
    const trimmed = inner.trim();
    const lower = trimmed.toLowerCase();

    if (lower === 'char') {
      const name = templateContext.char;
      return name !== undefined && name !== '' ? name : match;
    }

    if (lower === 'user') {
      const userName = templateContext.user;
      return userName !== undefined && userName !== '' ? userName : match;
    }

    if (lower.startsWith('//')) {
      return '';
    }

    if (lower.startsWith('random:')) {
      const argsStr = trimmed.slice('random:'.length);
      const options = splitCBSArgs(argsStr);
      return options[Math.floor(Math.random() * options.length)];
    }

    if (lower.startsWith('pick:')) {
      const argsStr = trimmed.slice('pick:'.length);
      const options = splitCBSArgs(argsStr);
      const hash = simpleHash(promptText || '');
      return options[hash % options.length];
    }

    if (lower.startsWith('roll:')) {
      const arg = trimmed.slice('roll:'.length).trim();
      const numStr = arg.replace(/^d/i, '');
      const n = parseInt(numStr, 10);
      if (isNaN(n) || n < 1) return match;
      return String(Math.floor(Math.random() * n) + 1);
    }

    if (lower.startsWith('reverse:')) {
      const arg = trimmed.slice('reverse:'.length);
      return arg.split('').reverse().join('');
    }

    return match;
  });
}

function applyLorebook(messages, resolvedConfig, lorebook) {
  const entries = lorebook.entries || [];
  if (entries.length === 0) return messages;

  const result = messages.map(m => ({ ...m }));
  const templateContext = buildTemplateContext(resolvedConfig, result);
  const hashSeed = serializeMessages(result);

  // Scannable message indices: skip system prompt (index 0) and initial user message (index 1)
  const scannableIndices = [];
  for (let i = 0; i < result.length; i++) {
    if (i === 0 && result[i].role === 'system') continue;
    if (i === 1 && result[i].role === 'user') continue;
    scannableIndices.push(i);
  }

  // All scannable text joined (used for selective secondary key checks)
  const allScannedText = scannableIndices.map(i => result[i].content || '').join('\n');

  // First non-system message index (insertion target for constant entries)
  const firstNonSystemIndex = (result.length > 0 && result[0].role === 'system') ? 1 : 0;

  // Map: message index -> array of matched entries
  const insertions = new Map();

  for (const entry of entries) {
    if (entry.enabled === false) continue;
    if (!entry.content) continue;

    if (entry.constant === true) {
      if (firstNonSystemIndex < result.length) {
        if (!insertions.has(firstNonSystemIndex)) insertions.set(firstNonSystemIndex, []);
        insertions.get(firstNonSystemIndex).push(entry);
      }
      continue;
    }

    const keys = entry.keys || [];
    const caseSensitive = entry.case_sensitive === true;

    // use_regex is intentionally ignored — executing attacker-supplied regex
    // patterns from untrusted charcard data is a ReDoS vector.

    // Find the first scannable message containing a matching primary key
    let targetIndex = -1;
    for (const idx of scannableIndices) {
      const msgText = result[idx].content || '';
      const textToSearch = caseSensitive ? msgText : msgText.toLowerCase();
      const found = keys.some(key => {
        const searchKey = caseSensitive ? key : key.toLowerCase();
        return textToSearch.includes(searchKey);
      });
      if (found) {
        targetIndex = idx;
        break;
      }
    }

    if (targetIndex === -1) continue;

    if (entry.selective === true) {
      const secondaryKeys = entry.secondary_keys || [];
      if (secondaryKeys.length > 0) {
        const textForSecondary = caseSensitive ? allScannedText : allScannedText.toLowerCase();
        const secondaryMatch = secondaryKeys.some(key => {
          const searchKey = caseSensitive ? key : key.toLowerCase();
          return textForSecondary.includes(searchKey);
        });
        if (!secondaryMatch) continue;
      }
    }

    if (!insertions.has(targetIndex)) insertions.set(targetIndex, []);
    insertions.get(targetIndex).push(entry);
  }

  if (insertions.size === 0) return messages;

  const entryTemplate = lorebook.entry_template || '[OOC: {{content}}]';

  // Insert entries into their target messages, sorted by insertion_order within each group
  for (const [idx, entryGroup] of insertions) {
    const target = result[idx];
    const messageContext = PROMPT_ROLES.includes(target.name)
      ? templateContext
      : { ...templateContext, char: target.name };
    entryGroup.sort((a, b) => (a.insertion_order || 0) - (b.insertion_order || 0));
    const renderedEntries = entryGroup.map(e => {
      const expanded = expandCBS(e.content, messageContext, hashSeed);
      return entryTemplate.replace('{{content}}', expanded);
    });
    target.content = (target.content || '') + '\n\n' + renderedEntries.join('\n');
  }

  return result;
}

function resolveLorebookPath(resolvedConfig, basePath) {
  const lorebookPath = resolvedConfig.lorebook;
  if (!lorebookPath) return undefined;
  if (path.isAbsolute(lorebookPath)) return lorebookPath;
  if (!basePath) return lorebookPath;
  return path.resolve(basePath, lorebookPath);
}

module.exports = { applyLorebook, resolveLorebookPath };
