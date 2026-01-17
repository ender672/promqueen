const Module = require('module');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const verbose = true;
const log = (...args) => { if (verbose) console.log(...args); };

// --- Mock VS Code ---
const documentMock = {
    uri: { fsPath: path.resolve(__dirname, '../../test_file.txt') },
    getText: () => "---\nfoo: bar\n---\nUser: Hello\n",
    lineCount: 2,
    lineAt: (index) => ({ range: { end: { line: index, character: 0 } } }),
    positionAt: (offset) => ({ line: 0, character: offset })
};

const editorMock = {
    document: documentMock,
    edit: async (callback, options) => {
        log(`[MockEditor] Edit called`);
        const editBuilder = {
            insert: (pos, text) => { }
        };
        await callback(editBuilder);
        return true;
    }
};

const vscodeMock = {
    window: {
        activeTextEditor: editorMock,
        showErrorMessage: (msg) => console.error('[VSCode Error]', msg),
        showInformationMessage: (msg) => log('[VSCode Info]', msg),
        showTextDocument: async (doc, options) => {
            log(`[VSCode] showTextDocument called with options: ${JSON.stringify(options)}`);
            log(`[VSCode] Document Content Preview:\n${doc.content}`);
            return true;
        }
    },
    workspace: {
        getWorkspaceFolder: () => ({ uri: { fsPath: path.resolve(__dirname, '../../') } }),
        openTextDocument: async (options) => {
            log(`[VSCode] openTextDocument called with options: ${JSON.stringify(options)}`);
            return options; // return options as the doc object for verification
        }
    },
    commands: {
        _commands: new Map(),
        registerCommand: (command, callback) => {
            log(`[VSCode] Registered command: ${command}`);
            vscodeMock.commands._commands.set(command, callback);
            return { dispose: () => { } };
        },
        executeCommand: async (command) => {
            log(`[VSCode] Executing command: ${command}`);
            if (vscodeMock.commands._commands.has(command)) {
                await vscodeMock.commands._commands.get(command)();
            }
        }
    },
    languages: {
        registerHoverProvider: () => ({ dispose: () => { } })
    }
};

// Intercept require to serve mock vscode
const originalRequire = Module.prototype.require;
Module.prototype.require = function (request) {
    if (request === 'vscode') {
        return vscodeMock;
    }
    return originalRequire.apply(this, arguments);
};

// --- Mock Fetch (for rptoprompt dependencies if any) ---
// rptoprompt might use fetch but usually it's mostly logic.
// However sendPrompt uses fetch. existing run_test mocks it.
// The preview command runs rptoprompt but NOT sendPrompt.
// But some imports might trigger things.

// --- Run Test ---
async function runTest() {
    log("=== Starting Preview Command Test ===");

    // Load extension
    const extension = require('../dist/extension.js');
    extension.activate({ subscriptions: [] });

    if (vscodeMock.commands._commands.has('promqueen.previewPrompt')) {
        log("Executing promqueen.previewPrompt...");
        try {
            await vscodeMock.commands._commands.get('promqueen.previewPrompt')();
            log("Command executed.");
        } catch (e) {
            console.error("Command failed:", e);
            process.exit(1);
        }
    } else {
        console.error("promqueen.previewPrompt command not registered!");
        process.exit(1);
    }
}

runTest();
