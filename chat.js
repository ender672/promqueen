#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { Command } = require('commander');
const { precompletionLint } = require('./pre-completion-lint.js');
const { postCompletionLint } = require('./post-completion-lint.js');
const { preparePrompt, dispatchSendPrompt } = require('./lib/pipeline.js');
const { pricingToString } = require('./lib/send-prompt-common.js');
const { extractAiCardData } = require('./lib/card-utils.js');
const { renderCharcardTemplate } = require('./charcard-png-to-txt.js');
const yaml = require('js-yaml');
const pqutils = require('./lib/pq-utils.js');

function promptTextInput(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

async function ensureRoleplayUser(dotConfig) {
    if (dotConfig.roleplay_user) return dotConfig;

    const dotConfigPath = path.join(os.homedir(), '.promqueen');
    const name = await promptTextInput('Enter your roleplay username: ');
    if (!name) {
        console.error('A roleplay username is required for character card chats.');
        process.exit(1);
    }

    dotConfig.roleplay_user = name;

    // Read existing file content (if any) and merge, or create new
    let existing = {};
    if (fs.existsSync(dotConfigPath)) {
        existing = yaml.load(fs.readFileSync(dotConfigPath, 'utf8')) || {};
    }
    existing.roleplay_user = name;

    fs.writeFileSync(dotConfigPath, yaml.dump(existing), 'utf8');
    process.stderr.write(`Saved roleplay_user "${name}" to ${dotConfigPath}\n`);

    return dotConfig;
}

function filterUsableProfiles(profiles) {
    const result = {};
    for (const [name, profile] of Object.entries(profiles)) {
        if (!profile.requires_env || process.env[profile.requires_env]) {
            result[name] = profile;
        }
    }
    return result;
}

function promptSelection(items, header, { previews } = {}) {
    let selected = 0;
    const cols = process.stderr.columns || 80;
    const maxPreviewLines = 12;

    function wrapText(text, width) {
        const lines = [];
        for (const rawLine of text.split('\n')) {
            if (rawLine.length <= width) {
                lines.push(rawLine);
            } else {
                for (let i = 0; i < rawLine.length; i += width) {
                    lines.push(rawLine.slice(i, i + width));
                }
            }
        }
        return lines;
    }

    function getPreviewLines() {
        if (!previews) return [];
        const wrapped = wrapText(previews[selected], cols - 2);
        const truncated = wrapped.slice(0, maxPreviewLines);
        if (wrapped.length > maxPreviewLines) truncated.push('...');
        return truncated;
    }

    // Fixed total height: items + separator + maxPreviewLines
    const totalLines = items.length + (previews ? 1 + maxPreviewLines : 0);

    const draw = () => {
        // Move cursor up to redraw
        process.stderr.write(`\x1b[${totalLines}A`);

        for (let i = 0; i < items.length; i++) {
            const marker = i === selected ? '\x1b[36m> ' : '  ';
            const reset = i === selected ? '\x1b[0m' : '';
            process.stderr.write(`\x1b[2K${marker}${items[i]}${reset}\n`);
        }

        if (previews) {
            const previewLines = getPreviewLines();
            process.stderr.write(`\x1b[2K\x1b[90m${'─'.repeat(Math.min(40, cols))}\x1b[0m\n`);
            for (let i = 0; i < maxPreviewLines; i++) {
                process.stderr.write(`\x1b[2K${i < previewLines.length ? '  ' + previewLines[i] : ''}\n`);
            }
        }
    };

    return new Promise((resolve) => {
        process.stderr.write(`\n${header}\n\n`);
        // Print initial blank lines so draw() can overwrite them
        for (let i = 0; i < totalLines; i++) {
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
                resolve(selected);
                return;
            }
            // Arrow keys: ESC [ A (up) / ESC [ B (down)
            if (key[0] === 0x1b && key[1] === 0x5b) {
                if (key[2] === 0x41) selected = (selected - 1 + items.length) % items.length; // up
                if (key[2] === 0x42) selected = (selected + 1) % items.length;                // down
                draw();
            }
        };

        process.stdin.on('data', onData);
    });
}

async function fetchModelList(profile) {
    const modelsUrl = profile.api_url.replace(/\/chat\/completions$/, '/models');
    const headers = pqutils.expandEnvVars(profile.api_call_headers);

    const response = await fetch(modelsUrl, { headers });
    if (!response.ok) {
        throw new Error(`Failed to fetch models from ${modelsUrl}: ${response.status} ${response.statusText}`);
    }
    const body = await response.json();
    const models = body.data || body;
    if (!Array.isArray(models)) {
        throw new Error(`Unexpected response from ${modelsUrl}: expected array of models`);
    }
    return models.map(m => m.id).sort();
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
        const statusPad = cur.endsWith('\n') ? '' : '\n';
        process.stdout.write(statusPad);
        const statusParts = [resolvedConfig.connection, pricingResult ? pricingToString(pricingResult) : 'no pricing data'];
        writeStatusLine(statusParts.join(' | '));
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
        const dotConfig = await ensureRoleplayUser(pqutils.loadDotConfig());
        const templatePath = path.join(__dirname, 'templates', 'charcard-prompt-charcard-complete.jinja');
        const templateText = fs.readFileSync(templatePath, 'utf8');
        const aiCardData = extractAiCardData(absolutePath);

        let altGreeting;
        const alternateGreetings = aiCardData.alternate_greetings || [];
        if (alternateGreetings.length > 0) {
            const charName = (aiCardData.name || 'Character').trim();
            const formatPreview = (text) => text.replaceAll('{{char}}', charName);
            const labels = ['First Message', ...alternateGreetings.map((_, i) => `Alternate Greeting ${i + 1}`)];
            const previews = [formatPreview(aiCardData.first_mes || ''), ...alternateGreetings.map(g => formatPreview(g))];
            const selectedIdx = await promptSelection(labels, 'Please select your opening message:', { previews });
            if (selectedIdx > 0) {
                altGreeting = selectedIdx - 1;
            }
        }

        const pqueenContent = renderCharcardTemplate(aiCardData, templateText, { altGreeting, roleplayUser: dotConfig.roleplay_user });
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
        const usableProfiles = filterUsableProfiles(resolvedConfig.connection_profiles);
        const usableNames = Object.keys(usableProfiles);
        if (usableNames.length === 0) {
            console.error('No usable connection profiles found. Set the required environment variable for at least one profile.');
            process.exit(1);
        }
        const selectedIdx = usableNames.length === 1
            ? 0
            : await promptSelection(usableNames, 'No connection profile selected. Choose one:');
        cliConfig.connection = usableNames[selectedIdx];
        // Re-resolve so the connection is validated
        pqutils.resolveConfig(doc.config, cwd, cliConfig);
    }

    // If the selected profile doesn't specify a model, fetch available models and prompt
    const activeConfig = pqutils.resolveConfig(doc.config, cwd, cliConfig);
    const connectionName = activeConfig.connection;
    const profile = pqutils.getConnectionProfile(activeConfig);
    if (!profile.api_call_props || !profile.api_call_props.model) {
        process.stderr.write(`\nFetching models from ${connectionName}...\n`);
        try {
            const modelIds = await fetchModelList(profile);
            if (modelIds.length === 0) {
                console.error('No models returned by the API.');
                process.exit(1);
            }
            const selectedModelIdx = modelIds.length === 1
                ? 0
                : await promptSelection(modelIds, 'Select a model:');
            const selectedModel = modelIds[selectedModelIdx];
            // Inject the selected model into the connection profile
            if (!cliConfig.connection_profiles) cliConfig.connection_profiles = {};
            cliConfig.connection_profiles[connectionName] = {
                api_call_props: { model: selectedModel }
            };
        } catch (err) {
            console.error(`Failed to fetch models: ${err.message}`);
            process.exit(1);
        }
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
