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

function generateApiMessages(messages, templatePath, templateContext) {
  const prompt = messages.map(message => {
    return {
      role: message.name,
      content: message.content
    }
  })

  const env = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(templatePath)
  );
  prompt.forEach(message => {
    message.content = env.renderString(message.content, templateContext);
  });

  return prompt;
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

  const { config, messages } = pqutils.parseConfigAndMessages(promptText);

  // Resolve config to get any template variables defined in the file/config
  // We use process.cwd() as base path for config resolution
  const resolvedConfig = pqutils.resolveConfig(config, process.cwd());

  const fullMessageTemplateContext = {
    ...options.data,
    ...resolvedConfig.message_template_variables,
  };

  const renderedMessages = generateApiMessages(messages, options.messageTemplateLoaderPath, fullMessageTemplateContext);

  // Reconstruct the output
  // We want to output the original frontmatter (or resolved? usually original + overrides)
  // But here we just want to output the processed messages with the config.
  // Let's dump the config back to YAML.

  const configYaml = yaml.dump(config);

  console.log('---');
  console.log(configYaml.trim());
  console.log('---');

  renderedMessages.forEach(msg => {
    console.log(`@${msg.role}`);
    console.log(msg.content);
    console.log(''); // Empty line between messages
  });
}

if (require.main === module) {
  main();
}
