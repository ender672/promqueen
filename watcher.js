#!/usr/bin/env node

const chokidar = require('chokidar');
const { runPipeline } = require('./pqueen-run.js');

function watchFiles(watchPath) {
  console.log(`Initializing watcher for: ${watchPath}`);

  const watcher = chokidar.watch(watchPath, {
    persistent: true,
    ignoreInitial: true,
    ignored: ['node_modules', '_formatnames_output.js'],
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

  return watcher;
}

function main() {
  const watchPath = process.argv[2];
  if (!watchPath) {
    console.error('Usage: node watcher.js <path_to_watch>');
    process.exit(1);
  }
  watchFiles(watchPath);
}

if (require.main === module) {
  main();
}

module.exports = {
  watchFiles
};
