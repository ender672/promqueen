#!/usr/bin/env node

const fs = require('fs');
const process = require('process');
const { parseConfigOnly, parseMessages } = require('./lib/pqutils');

function applyLorebook(promptText, lorebook) {
  const entries = lorebook.entries || [];
  if (entries.length === 0) return promptText;

  const { messagesString } = parseConfigOnly(promptText);
  const messages = parseMessages(messagesString);
  const scannedText = messages.map(m => m.content || '').join('\n');

  const matched = [];
  for (const entry of entries) {
    if (entry.enabled === false) continue;
    if (!entry.content) continue;

    // When use_regex is true, constant is ignored (per V3 spec)
    if (entry.constant === true && !entry.use_regex) {
      matched.push(entry);
      continue;
    }

    const keys = entry.keys || [];
    const caseSensitive = entry.case_sensitive === true;
    const useRegex = entry.use_regex === true;

    let keyMatches;
    if (useRegex) {
      const flags = caseSensitive ? '' : 'i';
      keyMatches = keys.some(key => {
        try {
          const re = new RegExp(key, flags);
          return re.test(scannedText);
        } catch {
          return false;
        }
      });
    } else {
      const textToSearch = caseSensitive ? scannedText : scannedText.toLowerCase();
      keyMatches = keys.some(key => {
        const searchKey = caseSensitive ? key : key.toLowerCase();
        return textToSearch.includes(searchKey);
      });
    }

    if (keyMatches) {
      matched.push(entry);
    }
  }

  if (matched.length === 0) return promptText;

  matched.sort((a, b) => (a.insertion_order || 0) - (b.insertion_order || 0));
  const joinedContent = matched.map(e => e.content).join('\n');
  const base = promptText.replace(/\n$/, '');
  return base + '\n' + joinedContent + '\n';
}

function main() {
  const commander = require('commander');

  commander.program.description('Apply a lorebook to a prompt file.');
  commander.program.argument('[prompt_path]', 'Path to the prompt file.');
  commander.program.requiredOption('-l, --lorebook <path>', 'Path to the lorebook JSON file.');
  commander.program.parse(process.argv);

  const [filePath] = commander.program.args;
  const options = commander.program.opts();

  let promptText;
  if (filePath && filePath !== '-') {
    promptText = fs.readFileSync(filePath, 'utf8');
  } else {
    promptText = fs.readFileSync(0, 'utf-8');
  }

  const lorebook = JSON.parse(fs.readFileSync(options.lorebook, 'utf8'));
  const output = applyLorebook(promptText, lorebook);
  process.stdout.write(output);
}

if (require.main === module) {
  main();
}

module.exports = { applyLorebook };
