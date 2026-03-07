#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const yaml = require('js-yaml');
const pqutils = require('./lib/pq-utils.js');
const { promptTextInput, promptSelection, filterUsableProfiles, fetchModelList } = require('./lib/tui.js');

const DOT_CONFIG_PATH = path.join(os.homedir(), '.promqueen');

function loadExistingConfig() {
    if (fs.existsSync(DOT_CONFIG_PATH)) {
        return yaml.load(fs.readFileSync(DOT_CONFIG_PATH, 'utf8')) || {};
    }
    return {};
}

function saveConfig(config) {
    fs.writeFileSync(DOT_CONFIG_PATH, yaml.dump(config), 'utf8');
}

async function main() {
    const existing = loadExistingConfig();

    process.stderr.write('\nPromQueen Setup\n');
    process.stderr.write('───────────────\n\n');

    if (fs.existsSync(DOT_CONFIG_PATH)) {
        process.stderr.write(`Updating ${DOT_CONFIG_PATH}\n\n`);
    } else {
        process.stderr.write(`Creating ${DOT_CONFIG_PATH}\n\n`);
    }

    // 1. Roleplay username
    const currentUser = existing.roleplay_user || '';
    const userPrompt = currentUser
        ? `Roleplay username [${currentUser}]: `
        : 'Roleplay username: ';
    const userName = (await promptTextInput(userPrompt)) || currentUser;
    if (!userName) {
        console.error('A roleplay username is required.');
        process.exit(1);
    }
    existing.roleplay_user = userName;

    // 2. User description
    const currentDesc = existing.roleplay_user_description || '';
    const descPrompt = currentDesc
        ? `User description [${currentDesc}]: `
        : 'User description (who you are in roleplays): ';
    const userDesc = (await promptTextInput(descPrompt)) || currentDesc;
    if (userDesc) {
        existing.roleplay_user_description = userDesc;
    }

    // 3. Connection profile selection
    const resolvedConfig = pqutils.resolveConfig({}, process.cwd());
    const allProfiles = resolvedConfig.connection_profiles || {};
    const profileNames = Object.keys(allProfiles);

    if (profileNames.length > 0) {
        const usable = filterUsableProfiles(allProfiles);

        const labels = profileNames.map(name => {
            const profile = allProfiles[name];
            const envVar = profile.requires_env;
            if (!envVar || process.env[envVar]) {
                return name;
            }
            return `${name}  (${envVar} not set)`;
        });

        const disabled = profileNames.map(name => !usable[name]);

        const selectedIdx = await promptSelection(labels, 'Select a model (you can pick a different model from the same provider next):', { disabled });
        const selectedName = profileNames[selectedIdx];
        const baseProfile = allProfiles[selectedName];
        const defaultModel = baseProfile.api_call_props && baseProfile.api_call_props.model;

        // If API key is available, offer to pick a different model from the provider
        if (usable[selectedName]) {
            const useDefaultLabel = `Use ${defaultModel || selectedName}`;
            const browseLabel = 'Browse other models from this provider...';
            const choiceIdx = await promptSelection([useDefaultLabel, browseLabel], 'Model selection:');

            if (choiceIdx === 0) {
                existing.connection = selectedName;
            } else {
                process.stderr.write(`\nFetching models...\n`);
                try {
                    const modelIds = await fetchModelList(baseProfile);
                    if (modelIds.length > 0) {
                        const selectedModelIdx = await promptSelection(modelIds, 'Select a model:');
                        const selectedModel = modelIds[selectedModelIdx];

                        if (selectedModel !== defaultModel) {
                            const newProfileName = selectedModel;
                            const newProfile = JSON.parse(JSON.stringify(baseProfile));
                            newProfile.api_call_props.model = selectedModel;
                            delete newProfile.pricing;

                            if (!existing.connection_profiles) existing.connection_profiles = {};
                            existing.connection_profiles[newProfileName] = newProfile;
                            existing.connection = newProfileName;
                        } else {
                            existing.connection = selectedName;
                        }
                    } else {
                        process.stderr.write('No models returned by the API.\n');
                        existing.connection = selectedName;
                    }
                } catch (err) {
                    process.stderr.write(`Could not fetch models: ${err.message}\nUsing default.\n`);
                    existing.connection = selectedName;
                }
            }
        } else {
            existing.connection = selectedName;
        }
    }

    saveConfig(existing);
    process.stderr.write(`\nSaved to ${DOT_CONFIG_PATH}\n`);
}

main();
