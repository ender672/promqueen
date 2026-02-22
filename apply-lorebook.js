#!/usr/bin/env node

const fs = require('fs');
const process = require('process');

function applyLorebook(promptText, lorebook) {
  // TODO: apply lorebook entries to promptText
  return promptText;
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
