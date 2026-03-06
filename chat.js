#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Command } = require('commander');
const { precompletionLint } = require('./pre-completion-lint.js');
const { applyTemplate } = require('./apply-template.js');
const { injectInstructions } = require('./inject-instructions.js');
const { formatNames } = require('./format-names.js');
const { sendPrompt } = require('./send-prompt.js');
const { sendPromptAnthropic } = require('./send-prompt-anthropic.js');
const { sendRawPrompt } = require('./send-raw-prompt.js');
const { applyLorebook, resolveLorebookPath } = require('./apply-lorebook.js');
const { combineAdjacentMessages } = require('./combine-messages.js');
const pqutils = require('./lib/pq-utils.js');

function displayConversation(messages) {
    for (const msg of messages) {
        if (msg.name) {
            process.stdout.write(`\x1b[36m@${msg.name}\x1b[0m\n`);
        }
        if (msg.content) {
            process.stdout.write(msg.content);
            if (!msg.content.endsWith('\n')) {
                process.stdout.write('\n');
            }
        }
    }
}

function ensureReadyForUserInput(absolutePath, userName) {
    const content = fs.readFileSync(absolutePath, 'utf8');
    const doc = pqutils.parseConfigAndMessages(content);
    const lastMsg = doc.messages.at(-1);

    // Already has an empty user message ready for input
    if (lastMsg && lastMsg.name === userName && (lastMsg.content === null || lastMsg.content === '')) {
        return;
    }

    // Determine padding from the raw file content
    let padding;
    if (content.endsWith('\n\n')) {
        padding = '';
    } else if (content.endsWith('\n')) {
        padding = '\n';
    } else {
        padding = '\n\n';
    }

    fs.appendFileSync(absolutePath, padding + `@${userName}\n`);
}

async function runChatTurn(absolutePath, rl) {
    const templateLoaderPath = path.dirname(absolutePath);
    const cwd = path.dirname(absolutePath);

    // Re-read and re-parse each turn to pick up any external edits
    let content = fs.readFileSync(absolutePath, 'utf8');
    let doc = pqutils.parseConfigAndMessages(content);
    const resolvedConfig = pqutils.resolveConfig(doc.config, cwd, {});

    // Pre-completion lint
    const preOutput = precompletionLint(doc.messages, resolvedConfig);
    if (preOutput) {
        fs.appendFileSync(absolutePath, preOutput);
        content = fs.readFileSync(absolutePath, 'utf8');
        doc = pqutils.parseConfigAndMessages(content);
    }

    // Ephemeral transforms (clone to avoid mutating parsed data)
    let apiMessages = structuredClone(doc.messages);

    let lorebookPath = resolveLorebookPath(resolvedConfig, templateLoaderPath);
    if (!lorebookPath) {
        const defaultPath = path.resolve(templateLoaderPath, 'character_book.json');
        if (fs.existsSync(defaultPath)) lorebookPath = defaultPath;
    }
    if (lorebookPath) {
        const lorebook = JSON.parse(fs.readFileSync(lorebookPath, 'utf8'));
        apiMessages = applyLorebook(apiMessages, resolvedConfig, lorebook);
    }

    apiMessages = applyTemplate(apiMessages, resolvedConfig, {
        messageTemplateLoaderPath: templateLoaderPath, cwd
    });

    apiMessages = injectInstructions(apiMessages, resolvedConfig, cwd);
    apiMessages = formatNames(apiMessages, resolvedConfig);
    apiMessages = combineAdjacentMessages(apiMessages);

    // Send to API — tee output to both stdout and file
    const fileStream = fs.createWriteStream(absolutePath, { flags: 'a' });
    const teeStream = {
        write(chunk) {
            process.stdout.write(chunk);
            fileStream.write(chunk);
        }
    };

    const controller = new AbortController();
    const onSigint = () => {
        controller.abort();
        // Re-attach default SIGINT after aborting so a second Ctrl+C exits
        process.removeListener('SIGINT', onSigint);
    };

    // Pause readline so it doesn't intercept SIGINT during streaming
    rl.pause();
    process.on('SIGINT', onSigint);

    try {
        process.stdout.write('\x1b[36m');
        if (resolvedConfig.api_url && resolvedConfig.api_url.endsWith('/v1/completions')) {
            await sendRawPrompt(apiMessages, resolvedConfig, teeStream, process.stderr, templateLoaderPath, { signal: controller.signal });
        } else if (resolvedConfig.api_url && resolvedConfig.api_url.includes('anthropic.com')) {
            await sendPromptAnthropic(apiMessages, resolvedConfig, teeStream, process.stderr, { signal: controller.signal });
        } else {
            await sendPrompt(apiMessages, resolvedConfig, teeStream, process.stderr, { signal: controller.signal });
        }
        process.stdout.write('\x1b[0m');
    } catch (err) {
        process.stdout.write('\x1b[0m');
        if (err.name === 'AbortError') {
            process.stderr.write('\n[cancelled]\n');
        } else {
            process.stderr.write(`\nError: ${err.message}\n`);
        }
    } finally {
        process.removeListener('SIGINT', onSigint);
        fileStream.end();
        await new Promise((resolve) => fileStream.on('finish', resolve));
        rl.resume();
    }

    process.stdout.write('\n');
}

async function main() {
    const program = new Command();
    program
        .argument('<file>', 'path to a .pqueen file')
        .parse();

    const filePath = program.args[0];
    const absolutePath = path.resolve(filePath);

    if (!fs.existsSync(absolutePath)) {
        console.error(`File not found: ${absolutePath}`);
        process.exit(1);
    }

    // Initial load to display conversation and determine user role
    const content = fs.readFileSync(absolutePath, 'utf8');
    const doc = pqutils.parseConfigAndMessages(content);
    const resolvedConfig = pqutils.resolveConfig(doc.config, path.dirname(absolutePath), {});
    const userName = resolvedConfig.roleplay_user || 'user';

    // Display existing conversation
    displayConversation(doc.messages);

    // Ensure file is ready for user input
    ensureReadyForUserInput(absolutePath, userName);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const prompt = `\x1b[32m@${userName}>\x1b[0m `;
    let activeTurn = null;

    const promptForInput = () => {
        rl.question(prompt, async (line) => {
            if (!line.trim()) {
                promptForInput();
                return;
            }

            // Append user's text to the file (the @UserName tag is already there)
            fs.appendFileSync(absolutePath, line);

            // Run the pipeline for this turn
            activeTurn = runChatTurn(absolutePath, rl);
            await activeTurn;
            activeTurn = null;

            // Prepare file for next user input
            ensureReadyForUserInput(absolutePath, userName);

            promptForInput();
        });
    };

    rl.on('close', async () => {
        if (activeTurn) {
            await activeTurn;
        }
        console.log('\nGoodbye!');
        process.exit(0);
    });

    promptForInput();
}

if (require.main === module) {
    main();
}

module.exports = { main };
