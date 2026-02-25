#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { precompletionLint } = require('./precompletionlint.js');
const { applyTemplate } = require('./applytemplate.js');
const { rpToPrompt } = require('./rptoprompt.js');
const { sendPrompt } = require('./sendprompt.js');
const { postCompletionLint } = require('./postcompletionlint.js');
const { applyLorebook, resolveLorebookPath } = require('./apply-lorebook.js');

async function runPipeline(filePath, { baseDir, cwd = process.cwd(), stderr = process.stderr, fileSystem = fs, quiet = false } = {}) {
    const absolutePath = path.resolve(filePath);
    const templateLoaderPath = path.dirname(absolutePath);

    if (!quiet) console.log(`[PIPELINE] Processing ${filePath}...`);

    try {
        // 1. Run precompletionlint
        let content = fileSystem.readFileSync(absolutePath, 'utf8');
        const preOutput = precompletionLint(content, baseDir);
        if (preOutput) {
            fileSystem.appendFileSync(absolutePath, preOutput);
            // Update content for the next step
            content = fileSystem.readFileSync(absolutePath, 'utf8');
        }

        // 2. Run applytemplate -> rptoprompt -> sendprompt
        const templated = applyTemplate(content, {
            messageTemplateLoaderPath: templateLoaderPath,
            data: {},
            cwd
        }, null);

        // 2b. Run apply-lorebook (if lorebook configured)
        const lorebookPath = resolveLorebookPath(templated);
        let withLorebook = templated;
        if (lorebookPath) {
            const lorebook = JSON.parse(fileSystem.readFileSync(lorebookPath, 'utf8'));
            withLorebook = applyLorebook(templated, lorebook);
        }

        const prompt = rpToPrompt(withLorebook, cwd);

        const fileStream = fileSystem.createWriteStream(absolutePath, { flags: 'a' });
        // We need to wait for the stream to finish
        await sendPrompt(prompt, cwd, fileStream, stderr, {});

        fileStream.end();

        await new Promise((fulfill) => fileStream.on('finish', fulfill));

        // 3. Run postcompletionlint
        content = fileSystem.readFileSync(absolutePath, 'utf8');
        const postOutput = postCompletionLint(content, baseDir);
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
