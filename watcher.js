#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { precompletionLint } = require('./precompletionlint.js');
const { applyTemplate } = require('./applytemplate.js');
const { rpToPrompt } = require('./rptoprompt.js');
const { sendPrompt } = require('./sendprompt.js');
const { postCompletionLint } = require('./postcompletionlint.js');

async function runPipeline(filePath) {
  const absolutePath = path.resolve(filePath);
  const templateLoaderPath = path.dirname(absolutePath);

  console.log(`[WATCHER] Processing ${filePath}...`);

  try {
    // 1. Run precompletionlint
    let content = fs.readFileSync(absolutePath, 'utf8');
    const preOutput = precompletionLint(content, __dirname);
    if (preOutput) {
      fs.appendFileSync(absolutePath, preOutput);
      // Update content for the next step
      content = fs.readFileSync(absolutePath, 'utf8');
    }

    // 2. Run applytemplate -> rptoprompt -> sendprompt
    const templated = await applyTemplate(content, {
      messageTemplateLoaderPath: templateLoaderPath,
      data: {}
    }, null);

    const prompt = await rpToPrompt(templated, process.cwd());

    const fileStream = fs.createWriteStream(absolutePath, { flags: 'a' });
    // We need to wait for the stream to finish
    await sendPrompt(prompt, process.cwd(), fileStream, process.stderr, {});

    fileStream.end();

    await new Promise((fulfill) => fileStream.on('finish', fulfill));

    // 3. Run postcompletionlint
    content = fs.readFileSync(absolutePath, 'utf8');
    const postOutput = postCompletionLint(content, __dirname);
    if (postOutput) {
      fs.appendFileSync(absolutePath, postOutput);
    }

    console.log(`[WATCHER] Finished processing ${filePath}`);

  } catch (error) {
    console.error(`[WATCHER] Error processing ${filePath}:`, error);
    throw error;
  }
}

async function watchFiles(watchPath) {
  console.log(`Initializing watcher for: ${watchPath}`);

  const watcher = chokidar.watch(watchPath, {
    persistent: true,
    ignoreInitial: true,
    ignored: ['node_modules', '_rptoprompt_output.js'],
  });

  watcher.on('change', async (filePath) => {
    console.log(`\n[WATCHER] Detected change in: ${filePath}`);

    // Unwatch to prevent infinite loops
    watcher.unwatch(filePath);

    try {
      await runPipeline(filePath);
    } catch (error) {
      console.error(`[WATCHER] Error processing ${filePath}:`, error.message);
    } finally {
      // Re-watch after a short delay to ensure file locks are released
      setTimeout(() => {
        watcher.add(filePath);
        console.log(`[WATCHER] Re-watching ${filePath}`);
      }, 1000);
    }
  });

  watcher.on('error', (error) => console.error(`Watcher error: ${error}`));

  console.log('[WATCHER] Ready and waiting for changes...');
}

async function main() {
  const watchPath = process.argv[2];
  if (!watchPath) {
    console.error('Usage: node watcher.js <path_to_watch>');
    process.exit(1);
  }
  await watchFiles(watchPath);
}

if (require.main === module) {
  main();
}

module.exports = {
  runPipeline
};
