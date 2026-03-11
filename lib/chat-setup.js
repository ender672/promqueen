const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const os = require('os');
const pqutils = require('./pq-utils.js');
const { extractAiCardData } = require('./card-utils.js');
const { buildTemplateView } = require('../charcard-png-to-txt.js');
const { Parser, Context } = require('@ender672/minja-js/minja');
const { promptTextInput, promptSelection, filterUsableProfiles, fetchModelList } = require('./tui.js');

const DOT_CONFIG_PATH = path.join(os.homedir(), '.promqueen');

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadDotConfigFile() {
    if (fs.existsSync(DOT_CONFIG_PATH)) {
        return yaml.load(fs.readFileSync(DOT_CONFIG_PATH, 'utf8')) || {};
    }
    return {};
}

function saveDotConfig(config) {
    fs.writeFileSync(DOT_CONFIG_PATH, yaml.dump(config), 'utf8');
}

// ─── File discovery ─────────────────────────────────────────────────────────

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
        .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
        .map(f => path.join(dir, f.name));
}

function getFilePreview(filePath, maxLines) {
    maxLines = maxLines || 8;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    let start = 0;
    if (lines[0] === '---') {
        const endIdx = lines.indexOf('---', 1);
        if (endIdx > 0) start = endIdx + 1;
    }
    const bodyLines = lines.slice(start);
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

// ─── Wizard steps ───────────────────────────────────────────────────────────

async function wizardSelectConnection(dotConfig) {
    const resolvedConfig = pqutils.resolveConfig({}, process.cwd());
    const allProfiles = resolvedConfig.connection_profiles || {};
    const profileNames = Object.keys(allProfiles);

    if (profileNames.length === 0) {
        console.error('No connection profiles found. Run pqueen-setup first.');
        process.exit(1);
    }

    const usable = filterUsableProfiles(allProfiles);

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

function createPqueenFile(pngPath, aiCardData, connectionName, userName, userDescription, altGreeting, roleplayGuidelines, charcardTemplate) {
    const dir = path.dirname(pngPath);
    const baseName = path.basename(pngPath, '.png');
    const safeName = baseName.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-');

    let pqueenPath = path.join(dir, `${safeName}.pqueen`);
    let suffix = 1;
    while (fs.existsSync(pqueenPath)) {
        pqueenPath = path.join(dir, `${safeName}-${suffix}.pqueen`);
        suffix++;
    }

    const templatePath = charcardTemplate
        ? path.resolve(charcardTemplate)
        : path.join(__dirname, '..', 'templates', 'charcard-prompt-complete.jinja');
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

    const charSheetTemplatePath = path.join(__dirname, '..', 'templates', 'charcard-char-sheet.jinja');
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

// ─── Connection helpers ─────────────────────────────────────────────────────

async function testExistingConnection(pqueenPath, cliConfig) {
    const cwd = path.dirname(pqueenPath);
    const content = fs.readFileSync(pqueenPath, 'utf8');
    const doc = pqutils.parseConfigAndMessages(content);

    if (!doc.config.connection) return false;

    let resolvedConfig;
    try {
        resolvedConfig = pqutils.resolveConfig(doc.config, cwd, cliConfig);
    } catch {
        return false;
    }

    const profile = pqutils.getConnectionProfile(resolvedConfig);
    if (!profile) return false;

    process.stderr.write(`Testing connection ${resolvedConfig.connection}...`);
    try {
        await fetchModelList(profile);
        process.stderr.write(' ok\n');
        return true;
    } catch {
        process.stderr.write(' failed\n');
        return false;
    }
}

function updatePqueenConnection(pqueenPath, connectionName) {
    const content = fs.readFileSync(pqueenPath, 'utf8');
    const doc = pqutils.parseConfigAndMessages(content);
    doc.config.connection = connectionName;
    fs.writeFileSync(pqueenPath, pqutils.serializeDocument(doc.config, doc.messages), 'utf8');
}

// ─── Setup orchestrator ─────────────────────────────────────────────────────

async function runSetup(pngPath) {
    const dotConfig = pqutils.loadDotConfig();
    let pqueenPath;
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

        const { userName, userDescription } = await wizardGetUserIdentity(dotConfig);
        const altGreeting = await wizardSelectOpeningMessage(aiCardData);

        pqueenPath = createPqueenFile(
            pngPath, aiCardData, null,
            userName, userDescription, altGreeting,
            dotConfig.roleplay_guidelines, dotConfig.charcard_pqueen_template
        );
    }

    return { pqueenPath };
}

module.exports = {
    findExistingPqueenFiles,
    getFilePreview,
    selectExistingOrNew,
    wizardSelectConnection,
    wizardGetUserIdentity,
    wizardSelectOpeningMessage,
    createPqueenFile,
    testExistingConnection,
    updatePqueenConnection,
    runSetup,
};
