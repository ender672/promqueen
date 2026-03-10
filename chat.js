#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Command } = require('commander');
const { precompletionLint } = require('./pre-completion-lint.js');
const { postCompletionLint } = require('./post-completion-lint.js');
const { preparePrompt, dispatchSendPrompt } = require('./lib/pipeline.js');
const { pricingToString } = require('./lib/send-prompt-common.js');
const pqutils = require('./lib/pq-utils.js');
const { runSetup } = require('./lib/chat-setup.js');

// ─── Chat engine ────────────────────────────────────────────────────────────

function writeStatusLine(text) {
    const cols = process.stdout.columns || 80;
    const padded = text.padEnd(cols).slice(0, cols);
    process.stdout.write(`\x1b[90m${padded}\x1b[0m\n`);
}

function displayConversation(messages, resolvedConfig, cwd) {
    const { buildTemplateContext } = require('./lib/render-template.js');
    const { renderTemplate } = require('./lib/render-template.js');
    const context = buildTemplateContext(resolvedConfig, messages, { cwd });

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (i > 0) process.stdout.write('\n');
        if (msg.name) process.stdout.write(`\x1b[36m@${msg.name}\x1b[0m\n`);
        if (msg.content) {
            const rendered = renderTemplate(msg.content, context, null, null, { allowIncludes: false });
            process.stdout.write(rendered);
            if (!rendered.endsWith('\n')) process.stdout.write('\n');
        }
    }
}

function createFileStore(absolutePath) {
    return {
        read() { return fs.readFileSync(absolutePath, 'utf8'); },
        append(text) { fs.appendFileSync(absolutePath, text); },
        createAppendStream() { return fs.createWriteStream(absolutePath, { flags: 'a' }); },
        size() { return fs.statSync(absolutePath).size; },
        truncate(byteLength) { fs.truncateSync(absolutePath, byteLength); },
    };
}

function ensureReadyForUserInput(store, userName) {
    const content = store.read();
    const doc = pqutils.parseConfigAndMessages(content);
    const lastMsg = doc.messages.at(-1);

    if (lastMsg && lastMsg.name === userName && (lastMsg.content === null || lastMsg.content === '')) {
        return;
    }

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
    const snapshotSize = store.size();

    let content = store.read();
    let doc = pqutils.parseConfigAndMessages(content);
    const resolvedConfig = pqutils.resolveConfig(doc.config, cwd, cliConfig);

    let preLintLines = 0;
    const preOutput = precompletionLint(doc.messages, resolvedConfig);
    if (preOutput) {
        store.append(preOutput);
        const displayOutput = preOutput.replace(/^\s+/, '\n').replace(/@(\S+)/g, '\x1b[36m@$1\x1b[0m');
        process.stdout.write(displayOutput);
        preLintLines = displayOutput.split('\n').filter(l => l.length > 0).length;
    }

    const apiMessages = preparePrompt(doc.messages, resolvedConfig, cwd, cwd);

    const chunks = [];
    const teeStream = {
        write(chunk) {
            process.stdout.write(chunk);
            chunks.push(chunk);
        }
    };

    const controller = new AbortController();
    const onSigint = () => {
        controller.abort();
        process.removeListener('SIGINT', onSigint);
    };

    rl.pause();
    process.on('SIGINT', onSigint);

    let pricingResult;
    let failed = false;
    let errorLines = 0;
    try {
        pricingResult = await dispatchSendPrompt(apiMessages, resolvedConfig, teeStream, cwd, { signal: controller.signal });
    } catch (err) {
        failed = true;
        if (err.name === 'AbortError') {
            process.stderr.write('\n[cancelled]\n');
            errorLines = 1;
        } else {
            const errMsg = `Error: ${err.message}`;
            const cols = process.stderr.columns || 80;
            errorLines = Math.ceil(errMsg.length / cols);
            process.stderr.write(`\n${errMsg}\n`);
        }
        errorLines += preLintLines;
    } finally {
        process.removeListener('SIGINT', onSigint);
        rl.resume();
    }

    if (failed) {
        store.truncate(snapshotSize);
        return { failed: true, errorLines };
    }

    store.append(chunks.join(''));

    if (opts.status) {
        const cur = store.read();
        const statusPad = cur.endsWith('\n') ? '' : '\n';
        process.stdout.write(statusPad);
        const statusParts = [resolvedConfig.connection, pricingResult ? pricingToString(pricingResult) : 'no pricing data'];
        writeStatusLine(statusParts.join(' | '));
    }

    content = store.read();
    doc = pqutils.parseConfigAndMessages(content);
    const postConfig = { ...resolvedConfig, user: resolvedConfig.user || resolvedConfig.roleplay_user };
    const postOutput = postCompletionLint(doc.messages, postConfig);
    if (postOutput) {
        const displayOutput = opts.status
            ? postOutput.replace(/^\n+/, '\n').replace(/@(\S+)/g, '\x1b[36m@$1\x1b[0m')
            : postOutput.replace(/@(\S+)/g, '\x1b[36m@$1\x1b[0m');
        process.stdout.write(displayOutput);
        store.append(postOutput);
    }

    return { failed: false, pricingResult };
}

function enterChat(pqueenPath, cliConfig, opts) {
    const store = createFileStore(pqueenPath);
    const cwd = path.dirname(pqueenPath);

    let content = store.read();
    let doc = pqutils.parseConfigAndMessages(content);
    const resolvedConfig = pqutils.resolveConfig(doc.config, cwd, cliConfig);
    const userName = resolvedConfig.roleplay_user || 'user';

    const preOutput = precompletionLint(doc.messages, resolvedConfig);
    if (preOutput) store.append(preOutput);

    displayConversation(doc.messages, resolvedConfig, cwd);
    ensureReadyForUserInput(store, userName);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    let activeTurn = null;

    const eraseLines = (n) => {
        for (let i = 0; i < n; i++) {
            process.stderr.write('\x1b[A\x1b[2K');
        }
    };

    const rewindToLastNonEmpty = () => {
        const content = store.read();
        const doc = pqutils.parseConfigAndMessages(content);
        while (doc.messages.length > 0) {
            const last = doc.messages.at(-1);
            if (!last.content || !last.content.trim()) {
                doc.messages.pop();
            } else {
                break;
            }
        }
        const rewound = pqutils.serializeDocument(doc.config, doc.messages);
        store.truncate(0);
        store.append(rewound);
    };

    let prefillText = null;

    const doTurn = async (preInputSize, userLine) => {
        activeTurn = runChatTurn(store, cwd, rl, opts, cliConfig);
        const result = await activeTurn;
        activeTurn = null;

        if (result && result.failed) {
            process.stderr.write('[press any key to dismiss]');
            return new Promise((resolve) => {
                rl.pause();
                process.stdin.setRawMode(true);
                process.stdin.resume();
                process.stdin.once('data', (key) => {
                    process.stdin.setRawMode(false);
                    if (key[0] === 3) { // Ctrl+C
                        rl.close();
                        return;
                    }
                    eraseLines(result.errorLines + 2);
                    store.truncate(preInputSize);
                    rewindToLastNonEmpty();
                    ensureReadyForUserInput(store, userName);
                    prefillText = userLine;
                    rl.resume();
                    resolve();
                });
            });
        }
    };

    const promptForInput = () => {
        rl.question('', async (line) => {
            if (!line.trim()) {
                promptForInput();
                return;
            }

            const preInputSize = store.size();
            store.append(line);
            await doTurn(preInputSize, line);
            promptForInput();
        });
        if (prefillText) {
            rl.write(prefillText);
            prefillText = null;
        }
    };

    rl.on('close', async () => {
        if (activeTurn) await activeTurn;
        process.stderr.write(`\nSaved to ${pqueenPath}\n`);
        console.log('Goodbye!');
        process.exit(0);
    });

    promptForInput();
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
    const program = new Command();
    program
        .argument('<png>', 'path to a character card PNG')
        .option('--status', 'show a persistent status line with cost info')
        .parse();

    const pngPath = path.resolve(program.args[0]);
    const opts = program.opts();

    if (!fs.existsSync(pngPath)) {
        console.error(`File not found: ${pngPath}`);
        process.exit(1);
    }
    if (!pngPath.endsWith('.png')) {
        console.error('Expected a .png character card file.');
        process.exit(1);
    }

    const { pqueenPath, cliConfig } = await runSetup(pngPath);
    enterChat(pqueenPath, cliConfig, opts);
}

if (require.main === module) {
    main();
}

module.exports = { main };
