#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Command } = require('commander');
const { precompletionLint } = require('./pre-completion-lint.js');
const { postCompletionLint } = require('./post-completion-lint.js');
const { preparePrompt, dispatchSendPrompt } = require('./lib/pipeline.js');
const { pricingToString } = require('./lib/send-prompt-common.js');
const { extractAiCardData } = require('./lib/card-utils.js');
const { createChatmlPrompt } = require('./charcard-png-to-txt.js');
const pqutils = require('./lib/pq-utils.js');

function promptConnectionSelection(profiles) {
    const names = Object.keys(profiles);
    let selected = 0;

    const draw = () => {
        // Move cursor up to redraw (except first draw)
        process.stderr.write(`\x1b[${names.length}A`);
        for (let i = 0; i < names.length; i++) {
            const marker = i === selected ? '\x1b[36m> ' : '  ';
            const reset = i === selected ? '\x1b[0m' : '';
            process.stderr.write(`\x1b[2K${marker}${names[i]}${reset}\n`);
        }
    };

    return new Promise((resolve) => {
        process.stderr.write('\nNo connection profile selected. Choose one:\n\n');
        // Print initial blank lines so draw() can overwrite them
        for (let i = 0; i < names.length; i++) {
            process.stderr.write('\n');
        }
        draw();

        const wasRaw = process.stdin.isRaw;
        process.stdin.setRawMode(true);
        process.stdin.resume();

        const onData = (key) => {
            // Ctrl+C
            if (key[0] === 0x03) {
                process.stdin.setRawMode(wasRaw);
                process.stdin.removeListener('data', onData);
                process.stderr.write('\n');
                process.exit(0);
            }
            // Enter
            if (key[0] === 0x0d) {
                process.stdin.setRawMode(wasRaw);
                process.stdin.removeListener('data', onData);
                process.stdin.pause();
                process.stderr.write('\n');
                resolve(names[selected]);
                return;
            }
            // Arrow keys: ESC [ A (up) / ESC [ B (down)
            if (key[0] === 0x1b && key[1] === 0x5b) {
                if (key[2] === 0x41) selected = (selected - 1 + names.length) % names.length; // up
                if (key[2] === 0x42) selected = (selected + 1) % names.length;                // down
                draw();
            }
        };

        process.stdin.on('data', onData);
    });
}

function writeStatusLine(text) {
    const cols = process.stdout.columns || 80;
    const padded = text.padEnd(cols).slice(0, cols);
    process.stdout.write(`\x1b[90m${padded}\x1b[0m\n`);
}

function displayConversation(messages) {
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (i > 0) {
            process.stdout.write('\n');
        }
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

function createFileStore(absolutePath) {
    return {
        read() { return fs.readFileSync(absolutePath, 'utf8'); },
        append(text) { fs.appendFileSync(absolutePath, text); },
        createAppendStream() { return fs.createWriteStream(absolutePath, { flags: 'a' }); },
    };
}

function createMemoryStore(initialContent) {
    return {
        content: initialContent,
        read() { return this.content; },
        append(text) { this.content += text; },
        createAppendStream() {
            const self = this;
            const noop = () => {};
            return {
                write(chunk) { self.content += chunk; },
                end: noop,
                on(ev, cb) { if (ev === 'finish') cb(); },
            };
        },
    };
}

function ensureReadyForUserInput(store, userName) {
    const content = store.read();
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

    store.append(padding + `@${userName}\n`);
}

async function runChatTurn(store, cwd, rl, opts, cliConfig) {
    const templateLoaderPath = cwd;

    // Re-read and re-parse each turn to pick up any external edits
    let content = store.read();
    let doc = pqutils.parseConfigAndMessages(content);
    const resolvedConfig = pqutils.resolveConfig(doc.config, cwd, cliConfig);

    // Pre-completion lint (mutates doc.messages, returns text to append)
    const preOutput = precompletionLint(doc.messages, resolvedConfig);
    if (preOutput) {
        store.append(preOutput);
        // Display to console: strip leading whitespace, colorize @name tags
        const displayOutput = preOutput.replace(/^\s+/, '\n').replace(/@(\S+)/g, '\x1b[36m@$1\x1b[0m');
        process.stdout.write(displayOutput);
    }

    // Ephemeral transforms
    const apiMessages = preparePrompt(doc.messages, resolvedConfig, templateLoaderPath, cwd);

    // Send to API — tee output to both stdout and store
    const appendStream = store.createAppendStream();
    const teeStream = {
        write(chunk) {
            process.stdout.write(chunk);
            appendStream.write(chunk);
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

    let pricingResult;
    try {
        pricingResult = await dispatchSendPrompt(apiMessages, resolvedConfig, teeStream, templateLoaderPath, { signal: controller.signal });
    } catch (err) {
        if (err.name === 'AbortError') {
            process.stderr.write('\n[cancelled]\n');
        } else {
            process.stderr.write(`\nError: ${err.message}\n`);
        }
    } finally {
        process.removeListener('SIGINT', onSigint);
        appendStream.end();
        await new Promise((resolve) => appendStream.on('finish', resolve));
        rl.resume();
    }

    if (opts.status) {
        const cur = store.read();
        const statusPad = cur.endsWith('\n') ? '\n' : '\n\n';
        process.stdout.write(statusPad);
        writeStatusLine(pricingResult ? pricingToString(pricingResult) : 'no pricing data');
    }

    // Post-completion lint: add padding and next speaker tag
    content = store.read();
    doc = pqutils.parseConfigAndMessages(content);
    const postConfig = { ...resolvedConfig, user: resolvedConfig.user || resolvedConfig.roleplay_user };
    const postOutput = postCompletionLint(doc.messages, postConfig);
    if (postOutput) {
        // When status is shown, it handles display spacing — strip stored padding from display
        const displayOutput = opts.status
            ? postOutput.replace(/^\n+/, '\n').replace(/@(\S+)/g, '\x1b[36m@$1\x1b[0m')
            : postOutput.replace(/@(\S+)/g, '\x1b[36m@$1\x1b[0m');
        process.stdout.write(displayOutput);
        store.append(postOutput);
    }

    return pricingResult;
}

async function main() {
    const program = new Command();
    program
        .argument('<file>', 'path to a .pqueen file or character card .png')
        .option('--no-save', 'do not save changes to the .pqueen file')
        .option('--status', 'show a persistent status line with cost info')
        .parse();

    const filePath = program.args[0];
    const opts = program.opts();
    const absolutePath = path.resolve(filePath);
    const cwd = path.dirname(absolutePath);

    if (!fs.existsSync(absolutePath)) {
        console.error(`File not found: ${absolutePath}`);
        process.exit(1);
    }

    let store;
    if (absolutePath.endsWith('.png')) {
        const dotConfig = pqutils.loadDotConfig();
        const templatePath = path.join(__dirname, 'templates', 'charcard-prompt-charcard-complete.jinja');
        const templateText = fs.readFileSync(templatePath, 'utf8');
        const aiCardData = extractAiCardData(absolutePath);
        const pqueenContent = createChatmlPrompt(aiCardData, templateText, { roleplayUser: dotConfig.roleplay_user });
        store = createMemoryStore(pqueenContent + '\n');
    } else if (opts.save === false) {
        store = createMemoryStore(fs.readFileSync(absolutePath, 'utf8'));
    } else {
        store = createFileStore(absolutePath);
    }

    // Initial load to display conversation and determine user role
    let content = store.read();
    let doc = pqutils.parseConfigAndMessages(content);
    let cliConfig = {};
    const resolvedConfig = pqutils.resolveConfig(doc.config, cwd, cliConfig);

    if (!resolvedConfig.connection) {
        const selected = await promptConnectionSelection(resolvedConfig.connection_profiles);
        cliConfig.connection = selected;
        // Re-resolve so the connection is validated
        pqutils.resolveConfig(doc.config, cwd, cliConfig);
    }

    const userName = resolvedConfig.roleplay_user || 'user';

    // Run pre-completion lint on startup (mutates doc.messages, returns text to append)
    const preOutput = precompletionLint(doc.messages, resolvedConfig);
    if (preOutput) {
        store.append(preOutput);
    }

    // Display existing conversation
    displayConversation(doc.messages);

    // Ensure file is ready for user input
    ensureReadyForUserInput(store, userName);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const prompt = '';
    let activeTurn = null;

    const promptForInput = () => {
        rl.question(prompt, async (line) => {
            if (!line.trim()) {
                promptForInput();
                return;
            }

            // Append user's text (the @UserName tag is already there)
            store.append(line);

            // Run the pipeline for this turn
            activeTurn = runChatTurn(store, cwd, rl, opts, cliConfig);
            await activeTurn;
            activeTurn = null;

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
