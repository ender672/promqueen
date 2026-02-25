#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const process = require('process');
const { parseConfigOnly, parseMessages, resolveConfig } = require('./lib/pqutils');
const { buildTemplateContext } = require('./lib/rendertemplate');

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

function applyLorebook(promptText, lorebook) {
  const entries = lorebook.entries || [];
  if (entries.length === 0) return promptText;

  const { config, messagesString } = parseConfigOnly(promptText);
  const messages = parseMessages(messagesString);
  const resolvedConfig = resolveConfig(config);
  const templateContext = buildTemplateContext(resolvedConfig, messages);

  let scannedText;
  if (lorebook.scan_depth !== undefined && lorebook.scan_depth !== null) {
    const nonSystemMessages = messages.filter(m => m.name !== 'system');
    const lastN = nonSystemMessages.slice(-lorebook.scan_depth);
    scannedText = lastN.map(m => m.content || '').join('\n');
  } else {
    scannedText = messages.map(m => m.content || '').join('\n');
  }

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

    // When selective is true and use_regex is false, require a secondary key match too
    if (keyMatches && entry.selective === true && !useRegex) {
      const secondaryKeys = entry.secondary_keys || [];
      if (secondaryKeys.length > 0) {
        const textForSecondary = caseSensitive ? scannedText : scannedText.toLowerCase();
        const secondaryMatch = secondaryKeys.some(key => {
          const searchKey = caseSensitive ? key : key.toLowerCase();
          return textForSecondary.includes(searchKey);
        });
        if (!secondaryMatch) keyMatches = false;
      }
    }

    if (keyMatches) {
      matched.push(entry);
    }
  }

  if (matched.length === 0) return promptText;

  matched.sort((a, b) => (a.insertion_order || 0) - (b.insertion_order || 0));
  const entryTemplate = lorebook.entry_template || '[OOC: {{content}}]';
  const joinedContent = matched.map(e => {
    const expanded = expandCBS(e.content, templateContext, promptText);
    return entryTemplate.replace('{{content}}', expanded);
  }).join('\n');
  const base = promptText.replace(/\n$/, '');
  return base + '\n' + joinedContent + '\n';
}

function resolveLorebookPath(promptText, basePath) {
  const { config } = parseConfigOnly(promptText);
  const resolvedConfig = resolveConfig(config);
  const lorebookPath = resolvedConfig.lorebook;
  if (!lorebookPath) return undefined;
  if (path.isAbsolute(lorebookPath)) return lorebookPath;
  if (!basePath) return lorebookPath;
  return path.resolve(basePath, lorebookPath);
}

function main() {
  const commander = require('commander');

  commander.program.description('Apply a lorebook to a prompt file.');
  commander.program.argument('[prompt_path]', 'Path to the prompt file.');
  commander.program.option('-l, --lorebook <path>', 'Path to the lorebook JSON file.');
  commander.program.parse(process.argv);

  const [filePath] = commander.program.args;
  const options = commander.program.opts();

  let promptText;
  if (filePath && filePath !== '-') {
    promptText = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  } else {
    promptText = fs.readFileSync(0, 'utf-8').replace(/\r\n/g, '\n');
  }

  const basePath = filePath && filePath !== '-' ? path.dirname(path.resolve(filePath)) : process.cwd();
  const lorebookPath = options.lorebook || resolveLorebookPath(promptText, basePath);
  if (!lorebookPath) {
    console.error('No lorebook path provided. Use --lorebook or set lorebook in frontmatter config.');
    process.exit(1);
  }

  const lorebook = JSON.parse(fs.readFileSync(lorebookPath, 'utf8'));
  const output = applyLorebook(promptText, lorebook);
  process.stdout.write(output);
}

if (require.main === module) {
  main();
}

module.exports = { applyLorebook, resolveLorebookPath };
