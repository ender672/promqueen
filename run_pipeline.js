#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { precompletionLint } = require('./precompletionlint.js');
const { applyTemplate } = require('./applytemplate.js');
const { rpToPrompt } = require('./rptoprompt.js');
const { sendPrompt } = require('./sendprompt.js');
const { postCompletionLint } = require('./postcompletionlint.js');

async function runPipeline(filePath, { baseDir } = {}) {
    const absolutePath = path.resolve(filePath);
    const templateLoaderPath = path.dirname(absolutePath);

    console.log(`[PIPELINE] Processing ${filePath}...`);

    try {
        // 1. Run precompletionlint
        let content = fs.readFileSync(absolutePath, 'utf8');
        const preOutput = precompletionLint(content, baseDir);
        if (preOutput) {
            fs.appendFileSync(absolutePath, preOutput);
            // Update content for the next step
            content = fs.readFileSync(absolutePath, 'utf8');
        }

        // 2. Run applytemplate -> rptoprompt -> sendprompt
        const templated = applyTemplate(content, {
            messageTemplateLoaderPath: templateLoaderPath,
            data: {},
            cwd: process.cwd()
        }, null);

        const prompt = rpToPrompt(templated, process.cwd());

        const fileStream = fs.createWriteStream(absolutePath, { flags: 'a' });
        // We need to wait for the stream to finish
        await sendPrompt(prompt, process.cwd(), fileStream, process.stderr, {});

        fileStream.end();

        await new Promise((fulfill) => fileStream.on('finish', fulfill));

        // 3. Run postcompletionlint
        content = fs.readFileSync(absolutePath, 'utf8');
        const postOutput = postCompletionLint(content, baseDir);
        if (postOutput) {
            fs.appendFileSync(absolutePath, postOutput);
        }

        console.log(`[PIPELINE] Finished processing ${filePath}`);

    } catch (error) {
        console.error(`[PIPELINE] Error processing ${filePath}:`, error);
        throw error;
    }
}

async function main() {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error('Usage: node run_pipeline.js <file_path>');
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
