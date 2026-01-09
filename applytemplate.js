#!/usr/bin/env node

const fs = require('fs');
const process = require('process');
const commander = require('commander');
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

async function applyTemplate(promptText, options, outputStream = process.stdout) {
  const { config, messages } = pqutils.parseConfigAndMessages(promptText);
  const resolvedConfig = pqutils.resolveConfig(config, process.cwd());

  const fullMessageTemplateContext = {
    ...options.data,
    ...resolvedConfig.message_template_variables,
  };

  if (fullMessageTemplateContext.char === undefined) {
    const skipNames = [...pqutils.PROMPT_ROLES, fullMessageTemplateContext.user];
    const firstCharMsg = messages.find(m => !skipNames.includes(m.name));

    if (firstCharMsg) {
      fullMessageTemplateContext.char = firstCharMsg.name;
    }
  }

  const env = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(options.messageTemplateLoaderPath)
  );

  let renderedMessages = [];
  for (let message of messages) {
    const content = env.renderString(message.content, fullMessageTemplateContext);
    const namePart = message.name ? `@${message.name}\n` : '';
    renderedMessages.push(`${namePart}${content}`);
  }

  outputStream.write('---\n');
  outputStream.write(yaml.dump(config));
  outputStream.write('---\n');
  outputStream.write(renderedMessages.join('\n\n'));
}

async function main() {
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

  await applyTemplate(promptText, options, process.stdout);
}

if (require.main === module) {
  main();
}

module.exports = { applyTemplate };
