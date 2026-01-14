#!/usr/bin/env node

const fs = require('fs');
const process = require('process');
const nunjucks = require('nunjucks');
const pqutils = require('./lib/pqutils.js');
const yaml = require('js-yaml');

function cmdLineParseDataArg(value, previous) {
  const eqIndex = value.indexOf('=');
  if (eqIndex === -1) {
    console.error(`Error: Invalid data format "${value}". Expected key=value`);
    process.exit(1);
  }

  const key = value.substring(0, eqIndex);
  let rawVal = value.substring(eqIndex + 1);
  let finalVal = rawVal;

  if (rawVal.startsWith('@')) {
    const path = rawVal.slice(1);
    if (path === '-') {
      finalVal = fs.readFileSync(0, 'utf-8');
    } else {
      finalVal = fs.readFileSync(path, 'utf-8');
    }
  }

  previous[key] = finalVal;
  return previous;
}

const { applyTemplate } = require('./lib/applytemplate-core.js');

async function main() {
  const commander = require('commander');
  commander.program.description('Apply Jinja2 templates to a prompt file.');
  commander.program.argument('[prompt_path]', 'Path to the prompt file.');
  commander.program.option('-d, --data <pair>', 'Key/value pairs (key=value, key=@file)', cmdLineParseDataArg, {});
  commander.program.option('-m, --message-template-loader-path <path>', 'Message template loader path.', process.cwd());
  commander.program.parse(process.argv);

  const [filePath] = commander.program.args;
  const options = commander.program.opts();

  let promptText;
  if (filePath && filePath !== '-') {
    promptText = fs.readFileSync(filePath, 'utf8');
  } else {
    promptText = fs.readFileSync(0, 'utf-8');
  }

  const output = await applyTemplate(promptText, options);

  if (filePath && filePath !== '-') {
    fs.writeFileSync(filePath, output);
  } else {
    process.stdout.write(output);
  }
}

if (require.main === module) {
  main();
}

module.exports = { applyTemplate };
