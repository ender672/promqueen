const Module = require('module');
const path = require('path');
const fs = require('fs');

// --- Mock VS Code ---
const documentMock = {
    uri: { fsPath: path.resolve(__dirname, '../../test_file.txt') },
    getText: () => "---\nfoo: bar\n---\nUser: Hello\n",
    lineCount: 2,
    lineAt: (index) => ({ range: { end: { line: index, character: 0 } } })
};

const editorMock = {
    document: documentMock,
    edit: async (callback) => {
        const editBuilder = {
            insert: (pos, text) => {
                console.log(`[MockEditor] Insert: ${JSON.stringify(text)}`);
            }
        };
        await callback(editBuilder);
        return true;
    }
};

class WorkspaceEditMock {
    constructor() {
        this.edits = [];
    }
    insert(uri, position, text) {
        this.edits.push({ type: 'insert', uri, position, text });
        console.log(`[WorkspaceEdit] Insert at ${JSON.stringify(position)}: ${JSON.stringify(text)}`);
    }
}

const vscodeMock = {
    WorkspaceEdit: WorkspaceEditMock,
    window: {
        activeTextEditor: editorMock,
        showErrorMessage: (msg) => console.error('[VSCode Error]', msg),
        showInformationMessage: (msg) => console.log('[VSCode Info]', msg)
    },
    workspace: {
        getWorkspaceFolder: () => ({ uri: { fsPath: path.resolve(__dirname, '../../') } }),
        applyEdit: async (edit) => {
            console.log(`[VSCode] Applying ${edit.edits.length} edits`);
            return true;
        }
    },
    commands: {
        registerCommand: (command, callback) => {
            console.log(`[VSCode] Registered command: ${command}`);
            // Expose callback to run it
            vscodeMock._commandCallback = callback;
            return { dispose: () => { } };
        }
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

// --- Mock Fetch for SendPrompt ---
global.fetch = async (url, options) => {
    console.log(`[MockFetch] Request to ${url}`);
    return {
        ok: true,
        headers: { get: () => 'text/event-stream' },
        body: (async function* () {
            const encoder = new TextEncoder();
            yield encoder.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: "AI response" } }] }) + '\n\n');
            yield encoder.encode('data: [DONE]\n\n');
        })()
    };
};

// --- Run Test ---
async function runTest() {
    console.log("=== Starting Test ===");

    // Load extension
    const extension = require('../dist/extension.js');
    extension.activate({ subscriptions: [] });

    if (vscodeMock._commandCallback) {
        console.log("Executing command callback...");
        try {
            await vscodeMock._commandCallback();
            console.log("Command finished successfully.");
        } catch (e) {
            console.error("Command failed:", e);
        }
    } else {
        console.error("Command not registered!");
    }
}

runTest();
