const path = require('path');
const { serializeMessages, PROMPT_ROLES } = require('./lib/pq-utils');
const { expandCBS, buildTemplateContext } = require('./lib/render-template');

function applyLorebook(messages, resolvedConfig, lorebook, options = {}) {
  const entries = lorebook.entries || [];
  if (entries.length === 0) return messages;

  const result = messages.map(m => ({ ...m }));
  const templateContext = buildTemplateContext(resolvedConfig, result, options);
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
