#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const process = require('process');
const nunjucks = require('nunjucks');
const pqutils = require('./lib/pqutils.js');

const PROMPT_ROLES = ['system', 'user', 'assistant'];

function buildNameMap(promptRoles, userName) {
  const nameMap = Object.fromEntries(
    promptRoles.map(role => [role, role])
  );
  nameMap[userName] = 'user';
  return nameMap;
}

function addRoles(history, userName) {
  const nameMap = buildNameMap(PROMPT_ROLES, userName);
  return history.map(roleplay => {
    const name = roleplay.name;
    const role = nameMap[name] || 'assistant';
    const message = { role: role, content: roleplay.content };
    if (name != role) {
        message.name = name;
    }
    return message;
  });
}

function renderHistory(history, basePath, vars) {
    const env = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(basePath)
    );
    return history.map(message => {
        return {
            role: message.role,
            name: message.name,
            content: env.renderString(message.content, vars),
        }
    })
}

function main() {
    const [,, filePath] = process.argv;

    if (!filePath) {
        console.error('Error: Please provide a file path as an argument.');
        console.log('Usage: node parseFile.js <path/to/your/file.txt>');
        process.exit(1);
    }

    const resolvedPath = path.resolve(filePath);
    const fileContent = fs.readFileSync(resolvedPath, 'utf8');

    const { config: runtimeConfig, history } = pqutils.parseDataAndChatHistory(fileContent);
    const config = pqutils.resolveConfig(runtimeConfig, __dirname);
    const user = config.user;

    const templateVars = {
        user: user,
        char: config.char,
    }
    const templatePath = path.dirname(resolvedPath);
    const renderedHistory = renderHistory(history, templatePath, templateVars);

    const roleHistory = addRoles(renderedHistory, user);
    const lastMessage = roleHistory.at(-1);

    process.stdout.write('---\n');
    process.stdout.write(yaml.dump(runtimeConfig));
    process.stdout.write('---\n');

    if (config.single_group_chat) {
      const sysPrompt = roleHistory.shift();
      if (!sysPrompt.role == 'system') throw new Error("Must start with system prompt.");
      process.stdout.write(`@${sysPrompt.role}\n${sysPrompt.content}`);
      process.stdout.write('\n\n@user\n');
      for (const [index, message] of roleHistory.entries()) {
        if (index !== 0) {
            process.stdout.write("\n\n");
        }
        process.stdout.write(`${message.name.toUpperCase()}\n${message.content}`)
      }
      if (config.single_group_chat_instruction) {
        const instruction = nunjucks.renderString(config.single_group_chat_instruction, {char: lastMessage.name});
        process.stdout.write(`\n\n${instruction}`);
      }
      process.exit(0);
    }

    if (config.impersonation_instruction && lastMessage.name === user && lastMessage.content === '') {
        const impersonationInstruction = nunjucks.renderString(config.impersonation_instruction, {char: user});
        lastMessage.content = impersonationInstruction;
    } else if (config.user_continuation_instruction && lastMessage.name === user && lastMessage.content.endsWith(' ')) {
        const continuationInstruction = nunjucks.renderString(config.user_continuation_instruction, {char: user});
        lastMessage.content += `\n\n${continuationInstruction}`;
    } else if (config.assistant_continuation_instruction && lastMessage.name !== user && lastMessage.content.endsWith(' ')) {
        const continuationInstruction = nunjucks.renderString(config.assistant_continuation_instruction, {char: lastMessage.name});
        roleHistory.push({role: 'user', content: continuationInstruction});
    }

    if (lastMessage.role === 'assistant' & lastMessage.content === '') {
        roleHistory.pop();
    }
    for (const [index, message] of roleHistory.entries()) {
        if (index !== 0) {
            process.stdout.write("\n\n");
        }
        process.stdout.write(`@${message.role}\n${message.content}`);
    }
}

main();
