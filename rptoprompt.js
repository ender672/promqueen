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

function rpToPrompt(filePath, outputStream = process.stdout) {
    if (!filePath) {
        throw new Error('Error: Please provide a file path as an argument.');
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

    outputStream.write('---\n');
    outputStream.write(yaml.dump(runtimeConfig));
    outputStream.write('---\n');

    if (config.single_group_chat) {
        const sysPrompt = roleHistory.shift();
        if (!sysPrompt.role == 'system') throw new Error("Must start with system prompt.");
        outputStream.write(`@${sysPrompt.role}\n${sysPrompt.content}`);
        outputStream.write('\n\n@user\n');
        for (const [index, message] of roleHistory.entries()) {
            if (index !== 0) {
                outputStream.write("\n\n");
            }
            outputStream.write(`${message.name.toUpperCase()}\n${message.content}`)
        }
        if (config.single_group_chat_instruction) {
            const instruction = nunjucks.renderString(config.single_group_chat_instruction, { char: lastMessage.name });
            outputStream.write(`\n\n${instruction}`);
        }
        return;
    }

    if (config.impersonation_instruction && lastMessage.name === user && lastMessage.content === '') {
        const impersonationInstruction = nunjucks.renderString(config.impersonation_instruction, { char: user });
        lastMessage.content = impersonationInstruction;
    } else if (config.user_continuation_instruction && lastMessage.name === user && lastMessage.content.endsWith(' ')) {
        const continuationInstruction = nunjucks.renderString(config.user_continuation_instruction, { char: user });
        lastMessage.content += `\n\n${continuationInstruction}`;
    } else if (config.assistant_continuation_instruction && lastMessage.name !== user && lastMessage.content.endsWith(' ')) {
        const continuationInstruction = nunjucks.renderString(config.assistant_continuation_instruction, { char: lastMessage.name });
        roleHistory.push({ role: 'user', content: continuationInstruction });
    }

    if (lastMessage.role === 'assistant' & lastMessage.content === '') {
        roleHistory.pop();
    }
    for (const [index, message] of roleHistory.entries()) {
        if (index !== 0) {
            outputStream.write("\n\n");
        }
        outputStream.write(`@${message.role}\n${message.content}`);
    }
}

function main() {
    const [, , filePath] = process.argv;

    try {
        rpToPrompt(filePath);
    } catch (e) {
        console.error(e.message);
        if (e.message.includes('Please provide a file path')) {
            console.log('Usage: node parseFile.js <path/to/your/file.txt>');
        }
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    rpToPrompt
};
