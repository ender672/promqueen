#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const chokidar = require('chokidar');

function runPipeline(filePath) {
  return new Promise(async (resolve, reject) => {
    const absolutePath = path.resolve(filePath);
    const templateLoaderPath = path.dirname(absolutePath);

    console.log(`[WATCHER] Processing ${filePath}...`);

    // Helper to run a command and pipe its stdout to the file
    const runStep = (command, args, pipeToFile = true) => {
      return new Promise((resolveStep, rejectStep) => {
        const proc = spawn(command, args);

        if (pipeToFile) {
          const fileStream = fs.createWriteStream(absolutePath, { flags: 'a' });
          proc.stdout.pipe(fileStream);

          fileStream.on('error', (err) => {
            console.error(`Error writing to file for ${command}:`, err);
            // Don't reject here, let the process exit handle it, or maybe we should?
            // For now, let's just log.
          });
        } else {
          proc.stdout.pipe(process.stdout);
        }

        let stderr = '';
        proc.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        proc.on('close', (code) => {
          if (code !== 0) {
            console.error(`${command} exited with code ${code}`);
            if (stderr) console.error(stderr);
            rejectStep(new Error(`${command} failed with code ${code}`));
          } else {
            resolveStep();
          }
        });

        proc.on('error', (err) => rejectStep(err));
      });
    };

    try {
      // 1. Run precompletionlint.js
      await runStep('node', ['precompletionlint.js', absolutePath]);

      // 2. Run rptoprompt.js -> sendprompt.js
      await new Promise((resolvePipeline, rejectPipeline) => {
        const templated = spawn('node', [
          'applytemplate.js',
          absolutePath,
          '--message-template-loader-path', templateLoaderPath
        ]);
        const rptoprompt = spawn('node', ['rptoprompt.js']);
        const sendprompt = spawn('node', ['sendprompt.js', '-']);

        const fileStream = fs.createWriteStream(absolutePath, { flags: 'a' });

        templated.stdout.pipe(rptoprompt.stdin);
        rptoprompt.stdout.pipe(sendprompt.stdin);
        sendprompt.stdout.pipe(fileStream);

        let rptopromptStderr = '';
        rptoprompt.stderr.on('data', (data) => rptopromptStderr += data.toString());

        let sendpromptStderr = '';
        sendprompt.stderr.on('data', (data) => sendpromptStderr += data.toString());

        rptoprompt.on('close', (code) => {
          if (code !== 0) {
            console.error(`rptoprompt exited with code ${code}`);
            if (rptopromptStderr) console.error(rptopromptStderr);
            sendprompt.kill();
            rejectPipeline(new Error(`rptoprompt failed with code ${code}`));
          }
        });

        sendprompt.on('close', (code) => {
          if (code !== 0) {
            console.error(`sendprompt exited with code ${code}`);
            if (sendpromptStderr) console.error(sendpromptStderr);
            rejectPipeline(new Error(`sendprompt failed with code ${code}`));
          } else {
            resolvePipeline();
          }
        });

        rptoprompt.on('error', rejectPipeline);
        sendprompt.on('error', rejectPipeline);
        fileStream.on('error', rejectPipeline);
      });

      // 3. Run postcompletionlint.js
      await runStep('node', ['postcompletionlint.js', absolutePath]);

      console.log(`[WATCHER] Finished processing ${filePath}`);
      resolve();

    } catch (error) {
      reject(error);
    }
  });
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

main();
