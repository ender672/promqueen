#!/usr/bin/env node

// This script recursively watches for .txt file updates
// and runs a chain of scripts (a, b, c) in response.
//
// THIS VERSION STREAMS all script output directly to files
// instead of buffering.

const fs = require('fs'); // Use 'fs' for streams
const path = require('path');
const { spawn } = require('child_process'); // Use spawn for streams
const chokidar = require('chokidar');

// --- Helper Function to Run Scripts and Stream Output ---
/**
 * Runs a Node.js script and pipes its stdout to a writable stream.
 * @param {string} scriptPath - Path to the .js script to run.
 * @param {string[]} args - An array of string arguments to pass.
 * @param {fs.WriteStream} outputStream - The stream to write stdout to.
 * @returns {Promise<boolean>} - A promise that resolves with true if data was written, false otherwise.
 */
function streamScriptOutput(scriptPath, args, outputStream) {
  return new Promise((resolve, reject) => {
    let dataWritten = false;
    const child = spawn('node', [scriptPath, ...args]);

    // Track if any data actually comes through stdout
    child.stdout.on('data', () => {
      dataWritten = true;
    });

    // Pipe stdout directly to the file stream.
    // We set end: false so the caller (which created the stream)
    // is responsible for calling outputStream.end().
    child.stdout.pipe(outputStream, { end: false });

    let stderrData = '';
    child.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`Error executing ${scriptPath}:`, stderrData.trim());
        return reject(new Error(stderrData || `Process exited with code ${code}`));
      }
      if (stderrData) {
        // Log warnings or other stderr output even on success
        console.warn(`Stderr from ${scriptPath}:`, stderrData.trim());
      }
      resolve(dataWritten); // Resolve with whether data was written
    });

    // Handle errors during spawn or process execution
    child.on('error', (error) => {
      reject(error);
    });

    // Handle errors on the output stream itself
    outputStream.on('error', (error) => {
      reject(error);
    });
  });
}

// --- Main Watcher Function ---
function watchFiles() {
  console.log("Initializing watcher for all '**/*.txt' files...");

  const watcher = chokidar.watch('../chat/**/*.txt', {
    persistent: true,
    ignoreInitial: true, // Don't fire on all existing files at start
    ignored: ['node_modules', '_rptoprompt_output.js'], // Ignore helper files
  });

  // --- File Change Event Handler ---
  watcher.on('change', async (filePath) => {
    console.log(`\n[WATCHER] Detected change in: ${filePath}`);
    const absolutePath = path.resolve(filePath);
    const rptopromptOutputPath = path.resolve('_rptoprompt_output.js');

    // CRITICAL: To prevent infinite loops, we temporarily stop
    // watching the file we are about to modify.
    watcher.unwatch(filePath);
    console.log(`[WATCHER] Unwatched ${filePath} to prevent loops.`);

    // We must manage stream lifecycles carefully
    let streamA = null;
    let streamB = null;
    let streamC = null;
    let streamD = null;

    try {
      // --- Step 1: Run precompletionprecompletionlint.js ---
      console.log(`[STEP 1/4] Running precompletionlint.js...`);
      streamA = fs.createWriteStream(absolutePath, { flags: 'a' });
      await streamScriptOutput('precompletionlint.js', [absolutePath], streamA);
      streamA.end(); // Manually end this stream
      streamA = null; // Clear reference
      console.log(`[STEP 1/4] Successfully streamed precompletionlint.js output.`);

      // --- Step 2: Run rptoprompt.js ---
      console.log(`[STEP 2/4] Running rptoprompt.js...`);
      streamB = fs.createWriteStream(rptopromptOutputPath, { flags: 'w' });
      await streamScriptOutput('rptoprompt.js', [absolutePath], streamB);
      streamB.end(); // Manually end this stream
      streamB = null; // Clear reference
      console.log(`[STEP 2/4] Successfully streamed rptoprompt.js output to ${rptopromptOutputPath}`);

      // --- Step 3: Run sendprompt.js ---
      console.log(`[STEP 3/4] Running sendprompt.js...`);
      streamC = fs.createWriteStream(absolutePath, { flags: 'a' });
      await streamScriptOutput('sendprompt.js', [rptopromptOutputPath], streamC);
      streamC.end(); // Manually end this stream
      streamC = null; // Clear reference
      console.log(`[STEP 3/4] Successfully streamed sendprompt.js output.`);

      // --- Step 4: Run precompletionprecompletionlint.js ---
      console.log(`[STEP 4/4] Running postcompletionlint.js...`);
      streamD = fs.createWriteStream(absolutePath, { flags: 'a' });
      await streamScriptOutput('precompletionlint.js', [absolutePath], streamD);
      streamD.end(); // Manually end this stream
      streamD = null; // Clear reference
      console.log(`[STEP 4/4] Successfully streamed precompletionlint.js output.`);

      console.log(`[WATCHER] Successfully processed ${filePath}`);

    } catch (error) {
      console.error(`[WATCHER] Error processing ${filePath}:`, error.message);
      // Ensure all streams are closed on error to prevent file locks
      if (streamA && !streamA.destroyed) streamA.end();
      if (streamB && !streamB.destroyed) streamB.end();
      if (streamC && !streamC.destroyed) streamC.end();
      if (streamD && !streamD.destroyed) streamD.end();
    } finally {
      // CRITICAL: Re-add the file to the watcher,
      // whether the process succeeded or failed.
      await new Promise(resolve => setTimeout(resolve, 1000));
      watcher.add(filePath);
      console.log(`[WATCHER] Re-watching ${filePath}. Waiting for next change...`);
    }
  });

  watcher.on('error', (error) => console.error(`Watcher error: ${error}`));

  console.log('Watcher is now running. Edit any .txt file to trigger the process.');
}

// Start the watcher
watchFiles();
