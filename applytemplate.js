#!/usr/bin/env node

const fs = require('fs');
const process = require('process');
const pqutils = require('./lib/pqutils.js');
const yaml = require('js-yaml');
const path = require('path');
const { renderTemplate, buildTemplateContext } = require('./lib/rendertemplate.js');

function getRole(name, roleplayUser) {
    if (name === 'system') return 'system';
    if (name === 'user' || name === roleplayUser) return 'user';
    if (name === null) return null;
    return 'assistant';
}

function canInclude(index, messages, roleplayUser) {
    const role = getRole(messages[index].name, roleplayUser);
    if (role === null) return true;
    if (index === 0) return true;
    if (index === 1) {
        const r0 = getRole(messages[0].name, roleplayUser);
        return (r0 === 'system' && (role === 'user' || role === 'assistant'))
            || (r0 === 'user' && role === 'assistant');
    }
    if (index === 2) {
        return getRole(messages[0].name, roleplayUser) === 'system'
            && getRole(messages[1].name, roleplayUser) === 'user'
            && role === 'assistant';
    }
    return false;
}

function applyTemplate(promptText, options) {
    const cwd = options.cwd || process.cwd();
    const { config, messages } = pqutils.parseConfigAndMessages(promptText);
    const resolvedConfig = pqutils.resolveConfig(config, cwd);
    const templateLoaderPath = resolvedConfig.message_template_loader_path || options.messageTemplateLoaderPath || cwd;
    const roleplayUser = resolvedConfig.roleplay_user;

    const fullMessageTemplateContext = {
        ...options.data,
        ...buildTemplateContext(resolvedConfig, messages),
    };

    let renderedMessages = [];
    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        const namePart = message.name ? `@${message.name}\n` : '';

        if (message.content === null) {
            renderedMessages.push(namePart.trimEnd());
            continue;
        }

        const allowIncludes = canInclude(i, messages, roleplayUser);
        // We pass a dummy file name 'root' joined to the loader path so that
        // renderTemplate's path.dirname() correctly resolves to templateLoaderPath
        const content = renderTemplate(
            message.content,
            fullMessageTemplateContext,
            path.join(templateLoaderPath, 'root'),
            templateLoaderPath,
            { allowIncludes }
        );
        const escaped = content.replace(/^@/gm, '\\@');
        renderedMessages.push(`${namePart}${escaped}`);
    }

    let output = '---\n';
    output += yaml.dump(config);
    output += '---\n';
    output += renderedMessages.join('\n\n');

    return output;
}

function main() {
  const commander = require('commander');

  function cmdLineParseDataArg(value, previous) {
    const eqIndex = value.indexOf('=');
    if (eqIndex === -1) {
      throw new commander.InvalidArgumentError(`Invalid data format "${value}". Expected key=value`);
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

  commander.program.description('Apply Jinja2 templates to a prompt file.');
  commander.program.argument('[prompt_path]', 'Path to the prompt file.');
  commander.program.option('-d, --data <pair>', 'Key/value pairs (key=value, key=@file)', cmdLineParseDataArg, {});
  commander.program.option('-m, --message-template-loader-path <path>', 'Message template loader path.', process.cwd());
  commander.program.parse(process.argv);

  const [filePath] = commander.program.args;
  const options = commander.program.opts();

  let promptText;
  if (filePath && filePath !== '-') {
    promptText = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  } else {
    promptText = fs.readFileSync(0, 'utf-8').replace(/\r\n/g, '\n');
  }

  const output = applyTemplate(promptText, { ...options, cwd: process.cwd() });
  process.stdout.write(output);
}

if (require.main === module) {
  main();
}

module.exports = { applyTemplate };
