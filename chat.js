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
const { buildTemplateView } = require('./charcard-png-to-txt.js');
const { Parser, Context } = require('@ender672/minja-js/minja');
const yaml = require('js-yaml');
const pqutils = require('./lib/pq-utils.js');
const { promptTextInput, promptSelection, filterUsableProfiles, fetchModelList } = require('./lib/tui.js');

const DOT_CONFIG_PATH = path.join(os.homedir(), '.promqueen');

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
    let content = store.read();
    let doc = pqutils.parseConfigAndMessages(content);
    const resolvedConfig = pqutils.resolveConfig(doc.config, cwd, cliConfig);

    const preOutput = precompletionLint(doc.messages, resolvedConfig);
    if (preOutput) {
        store.append(preOutput);
        const displayOutput = preOutput.replace(/^\s+/, '\n').replace(/@(\S+)/g, '\x1b[36m@$1\x1b[0m');
        process.stdout.write(displayOutput);
    }

    const apiMessages = preparePrompt(doc.messages, resolvedConfig, cwd, cwd);

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
        process.removeListener('SIGINT', onSigint);
    };

    rl.pause();
    process.on('SIGINT', onSigint);

    let pricingResult;
    try {
        pricingResult = await dispatchSendPrompt(apiMessages, resolvedConfig, teeStream, cwd, { signal: controller.signal });
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

    return pricingResult;
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

    const promptForInput = () => {
        rl.question('', async (line) => {
            if (!line.trim()) {
                promptForInput();
                return;
            }

            store.append(line);
            activeTurn = runChatTurn(store, cwd, rl, opts, cliConfig);
            await activeTurn;
            activeTurn = null;
            promptForInput();
        });
    };

    rl.on('close', async () => {
        if (activeTurn) await activeTurn;
        process.stderr.write(`\nSaved to ${pqueenPath}\n`);
        console.log('Goodbye!');
        process.exit(0);
    });

    promptForInput();
}

// ─── Setup wizard ───────────────────────────────────────────────────────────

function findExistingPqueenFiles(pngPath) {
    const dir = path.dirname(pngPath);
    const pngBase = path.basename(pngPath);
    return fs.readdirSync(dir)
        .filter(f => {
            if (!f.endsWith('.pqueen')) return false;
            try {
                const content = fs.readFileSync(path.join(dir, f), 'utf8');
                const doc = pqutils.parseConfigAndMessages(content);
                return doc.config.charcard === pngBase;
            } catch {
                return false;
            }
        })
        .sort()
        .map(f => path.join(dir, f));
}

function getFilePreview(filePath, maxLines) {
    maxLines = maxLines || 8;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    // Skip YAML frontmatter for preview
    let start = 0;
    if (lines[0] === '---') {
        const endIdx = lines.indexOf('---', 1);
        if (endIdx > 0) start = endIdx + 1;
    }
    const bodyLines = lines.slice(start);
    // Take last N non-empty body lines
    const trimmed = bodyLines.filter(l => l.trim().length > 0);
    return trimmed.slice(-maxLines).join('\n');
}

async function selectExistingOrNew(existingFiles) {
    const labels = ['+ Start new chat', ...existingFiles.map(f => path.basename(f))];
    const previews = ['', ...existingFiles.map(f => getFilePreview(f))];
    const idx = await promptSelection(labels, 'Existing chats found:', { previews });
    if (idx === 0) return null;
    return existingFiles[idx - 1];
}

function loadDotConfigFile() {
    if (fs.existsSync(DOT_CONFIG_PATH)) {
        return yaml.load(fs.readFileSync(DOT_CONFIG_PATH, 'utf8')) || {};
    }
    return {};
}

function saveDotConfig(config) {
    fs.writeFileSync(DOT_CONFIG_PATH, yaml.dump(config), 'utf8');
}

async function wizardSelectConnection(dotConfig) {
    const resolvedConfig = pqutils.resolveConfig({}, process.cwd());
    const allProfiles = resolvedConfig.connection_profiles || {};
    const profileNames = Object.keys(allProfiles);

    if (profileNames.length === 0) {
        console.error('No connection profiles found. Run pqueen-setup first.');
        process.exit(1);
    }

    const usable = filterUsableProfiles(allProfiles);

    // Move default connection to front of list for pre-selection
    const defaultConnection = dotConfig.connection;
    if (defaultConnection && profileNames.includes(defaultConnection)) {
        profileNames.splice(profileNames.indexOf(defaultConnection), 1);
        profileNames.unshift(defaultConnection);
    }

    const labels = profileNames.map(name => {
        const profile = allProfiles[name];
        const envVar = profile.requires_env;
        let label = name;
        if (name === defaultConnection) label += '  (default)';
        if (envVar && !process.env[envVar]) label += `  (${envVar} not set)`;
        return label;
    });
    const disabled = profileNames.map(name => !usable[name]);

    const selectedIdx = profileNames.length === 1
        ? 0
        : await promptSelection(labels, 'Select a connection:', { disabled });
    const selectedName = profileNames[selectedIdx];
    const baseProfile = allProfiles[selectedName];
    const defaultModel = baseProfile.api_call_props && baseProfile.api_call_props.model;

    // If the profile is usable, offer model selection
    if (!usable[selectedName]) {
        return { connectionName: selectedName, cliConfig: {} };
    }

    if (defaultModel) {
        const choiceIdx = await promptSelection(
            [`Use ${defaultModel}`, 'Browse other models from this provider...'],
            'Model selection:'
        );
        if (choiceIdx === 0) {
            return { connectionName: selectedName, cliConfig: {} };
        }
    }

    // Fetch and select model
    process.stderr.write('\nFetching models...\n');
    try {
        const modelIds = await fetchModelList(baseProfile);
        if (modelIds.length === 0) {
            process.stderr.write('No models returned by the API.\n');
            return { connectionName: selectedName, cliConfig: {} };
        }
        const selectedModelIdx = modelIds.length === 1
            ? 0
            : await promptSelection(modelIds, 'Select a model:');
        const selectedModel = modelIds[selectedModelIdx];

        if (selectedModel === defaultModel) {
            return { connectionName: selectedName, cliConfig: {} };
        }

        // Save custom model profile to ~/.promqueen (like setup.js)
        const dotConfigFile = loadDotConfigFile();
        const newProfile = JSON.parse(JSON.stringify(baseProfile));
        newProfile.api_call_props.model = selectedModel;
        delete newProfile.pricing;

        if (!dotConfigFile.connection_profiles) dotConfigFile.connection_profiles = {};
        dotConfigFile.connection_profiles[selectedModel] = newProfile;
        saveDotConfig(dotConfigFile);

        return { connectionName: selectedModel, cliConfig: {} };
    } catch (err) {
        process.stderr.write(`Could not fetch models: ${err.message}\nUsing default.\n`);
        return { connectionName: selectedName, cliConfig: {} };
    }
}

async function wizardGetUserIdentity(dotConfig) {
    const currentUser = dotConfig.roleplay_user || '';
    const userPrompt = currentUser
        ? `Roleplay username [${currentUser}]: `
        : 'Roleplay username: ';
    const userName = (await promptTextInput(userPrompt)) || currentUser;
    if (!userName) {
        console.error('A roleplay username is required.');
        process.exit(1);
    }

    const currentDesc = dotConfig.roleplay_user_description || '';
    const descPrompt = currentDesc
        ? `User description [${currentDesc}]: `
        : 'User description (who you are in roleplays): ';
    const userDesc = (await promptTextInput(descPrompt)) || currentDesc;

    // Save to ~/.promqueen if changed
    const dotConfigFile = loadDotConfigFile();
    let changed = false;
    if (userName !== dotConfigFile.roleplay_user) {
        dotConfigFile.roleplay_user = userName;
        changed = true;
    }
    if (userDesc && userDesc !== dotConfigFile.roleplay_user_description) {
        dotConfigFile.roleplay_user_description = userDesc;
        changed = true;
    }
    if (changed) saveDotConfig(dotConfigFile);

    return { userName, userDescription: userDesc || '' };
}

async function wizardSelectOpeningMessage(aiCardData) {
    const alternateGreetings = aiCardData.alternate_greetings || [];
    if (alternateGreetings.length === 0) return undefined;

    const charName = (aiCardData.name || 'Character').trim();
    const formatPreview = (text) => text.replaceAll('{{char}}', charName);
    const labels = ['First Message', ...alternateGreetings.map((_, i) => `Alternate Greeting ${i + 1}`)];
    const previews = [formatPreview(aiCardData.first_mes || ''), ...alternateGreetings.map(g => formatPreview(g))];
    const selectedIdx = await promptSelection(labels, 'Select an opening message:', { previews });
    return selectedIdx > 0 ? selectedIdx - 1 : undefined;
}

function createPqueenFile(pngPath, aiCardData, connectionName, userName, userDescription, altGreeting, roleplayGuidelines) {
    const dir = path.dirname(pngPath);
    const charName = (aiCardData.name || path.basename(pngPath, '.png')).trim();
    const safeName = charName.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').toLowerCase();

    let pqueenPath = path.join(dir, `${safeName}.pqueen`);
    let suffix = 1;
    while (fs.existsSync(pqueenPath)) {
        pqueenPath = path.join(dir, `${safeName}-${suffix}.pqueen`);
        suffix++;
    }

    const templatePath = path.join(__dirname, 'templates', 'charcard-prompt-complete.jinja');
    const templateText = fs.readFileSync(templatePath, 'utf8');

    const view = buildTemplateView(aiCardData, { altGreeting });
    view.char = view.charcard.name;
    view.user = userName;
    view.connection = connectionName;
    view.charcard_path = path.basename(pngPath);
    const openingRaw = view.charcard.first_mes || '';
    const openingRoot = Parser.parse(openingRaw);
    view.opening_message = openingRoot.render(Context.make(view));
    if (userDescription) view.user_description = userDescription;
    if (roleplayGuidelines) view.roleplay_guidelines = roleplayGuidelines;

    const charSheetTemplatePath = path.join(__dirname, 'templates', 'charcard-char-sheet.jinja');
    const charSheetTemplateText = fs.readFileSync(charSheetTemplatePath, 'utf8');
    const charSheetRoot = Parser.parse(charSheetTemplateText);
    view.charcard_char_sheet = charSheetRoot.render(Context.make(view)).trimEnd();

    const root = Parser.parse(templateText);
    const ctx = Context.make(view);
    const content = root.render(ctx).trimEnd();

    fs.writeFileSync(pqueenPath, content + '\n', 'utf8');
    process.stderr.write(`Created ${pqueenPath}\n`);
    return pqueenPath;
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

    const dotConfig = pqutils.loadDotConfig();
    let pqueenPath;
    let cliConfig = {};

    // Phase 1: Check for existing .pqueen files
    const existingFiles = findExistingPqueenFiles(pngPath);
    if (existingFiles.length > 0) {
        pqueenPath = await selectExistingOrNew(existingFiles);
    }

    // Phase 2: Create new .pqueen file
    if (!pqueenPath) {
        const aiCardData = extractAiCardData(pngPath);
        const charName = (aiCardData.name || 'Character').trim();
        process.stderr.write(`\nNew chat with ${charName}\n`);
        process.stderr.write('─'.repeat(Math.min(40, (process.stderr.columns || 80))) + '\n');

        const connResult = await wizardSelectConnection(dotConfig);
        cliConfig = connResult.cliConfig;
        const connectionName = connResult.connectionName;

        const { userName, userDescription } = await wizardGetUserIdentity(dotConfig);
        const altGreeting = await wizardSelectOpeningMessage(aiCardData);

        pqueenPath = createPqueenFile(
            pngPath, aiCardData, connectionName,
            userName, userDescription, altGreeting,
            dotConfig.roleplay_guidelines
        );
    }

    // Phase 3: Enter chat
    enterChat(pqueenPath, cliConfig, opts);
}

if (require.main === module) {
    main();
}

module.exports = { main };
