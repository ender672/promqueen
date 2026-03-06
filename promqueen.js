#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { precompletionLint } = require('./precompletionlint.js');
const { applyTemplate } = require('./applytemplate.js');
const { injectInstructions } = require('./inject-instructions.js');
const { formatNames } = require('./formatnames.js');
const { sendPrompt } = require('./sendprompt.js');
const { sendRawPrompt } = require('./sendrawprompt.js');
const { postCompletionLint } = require('./postcompletionlint.js');
const { applyLorebook, resolveLorebookPath } = require('./apply-lorebook.js');
const { combineAdjacentMessages } = require('./combine-messages.js');
const pqutils = require('./lib/pqutils.js');

async function runPipeline(filePath, { cwd = process.cwd(), stderr = process.stderr, fileSystem = fs, quiet = false } = {}) {
    const absolutePath = path.resolve(filePath);
    const templateLoaderPath = path.dirname(absolutePath);

    if (!quiet) console.log(`[PIPELINE] Processing ${filePath}...`);

    try {
        // 1. Parse once
        let content = fileSystem.readFileSync(absolutePath, 'utf8');
        let doc = pqutils.parseConfigAndMessages(content);

        // 2. Resolve config once for the entire pipeline
        const resolvedConfig = pqutils.resolveConfig(doc.config, cwd, {});

        // 3. Pre-completion lint (returns text to append)
        const preOutput = precompletionLint(doc.messages, resolvedConfig);
        if (preOutput) {
            fileSystem.appendFileSync(absolutePath, preOutput);
            content = fileSystem.readFileSync(absolutePath, 'utf8');
            doc = pqutils.parseConfigAndMessages(content);
        }

        // 4. Ephemeral transforms (each copies messages before transforming)
        let apiMessages = doc.messages;

        const lorebookPath = resolveLorebookPath(resolvedConfig, templateLoaderPath);
        if (lorebookPath) {
            const lorebook = JSON.parse(fileSystem.readFileSync(lorebookPath, 'utf8'));
            apiMessages = applyLorebook(apiMessages, resolvedConfig, lorebook);
        }

        apiMessages = applyTemplate(apiMessages, resolvedConfig, {
            messageTemplateLoaderPath: templateLoaderPath, cwd
        });

        apiMessages = injectInstructions(apiMessages, resolvedConfig, cwd);
        apiMessages = formatNames(apiMessages, resolvedConfig);
        apiMessages = combineAdjacentMessages(apiMessages);

        // 5. Send to API (streams response to file)
        const fileStream = fileSystem.createWriteStream(absolutePath, { flags: 'a' });
        if (resolvedConfig.api_url && resolvedConfig.api_url.endsWith('/v1/completions')) {
            await sendRawPrompt(apiMessages, resolvedConfig, fileStream, stderr, templateLoaderPath);
        } else {
            await sendPrompt(apiMessages, resolvedConfig, fileStream, stderr);
        }

        fileStream.end();
        await new Promise((fulfill) => fileStream.on('finish', fulfill));

        // 6. Post-completion lint (re-read file with API response)
        content = fileSystem.readFileSync(absolutePath, 'utf8');
        doc = pqutils.parseConfigAndMessages(content);
        const postOutput = postCompletionLint(doc.messages, resolvedConfig);
        if (postOutput) {
            fileSystem.appendFileSync(absolutePath, postOutput);
        }

        if (!quiet) console.log(`[PIPELINE] Finished processing ${filePath}`);

    } catch (error) {
        console.error(`[PIPELINE] Error processing ${filePath}:`, error);
        throw error;
    }
}

async function main() {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error('Usage: node promqueen.js <file_path>');
        process.exit(1);
    }

    try {
        await runPipeline(filePath, { baseDir: __dirname });
    } catch {
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    runPipeline
};
