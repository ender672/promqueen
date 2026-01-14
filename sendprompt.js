#!/usr/bin/env node

const fs = require('fs');
const process = require('process');
const eventsourceParser = require('eventsource-parser');
const pqutils = require('./lib/pqutils.js');
const console = require('console');
const path = require('path');
const yaml = require('js-yaml');


const { sendPrompt } = require('./lib/sendprompt-core.js');

async function main() {
  const commander = require('commander');
  commander.program.description('Send a prompt to an LLM.');
  commander.program.argument('[prompt_path]', 'Path to the prompt file.');
  commander.program.option('-e, --expression <string>', 'Inline prompt string');
  commander.program.option('-c, --config <path>', 'Path to a YAML config file');
  commander.program.parse(process.argv);
  const [filePath] = commander.program.args;
  const options = commander.program.opts();

  let cliConfig = {};
  if (options.config) {
    try {
      const configContent = fs.readFileSync(options.config, 'utf8');
      cliConfig = yaml.load(configContent) || {};
    } catch (e) {
      console.error(`Error loading config file: ${e.message}`);
      process.exit(1);
    }
  }

  let prompt = options.expression;
  if (filePath && filePath !== '-') {
    prompt = fs.readFileSync(filePath, 'utf8');
  } else if (!prompt) {
    prompt = fs.readFileSync(0, 'utf-8');
  }
  await sendPrompt(prompt, process.cwd(), process.stdout, process.stderr, cliConfig);
}

if (require.main === module) {
  main();
}

module.exports = { sendPrompt };
