const Module = require('module');
const path = require('path');
const fs = require('fs');

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
        console.log(`[MockEditor] Edit called with options: ${JSON.stringify(options)}`);
        const editBuilder = {
            insert: (pos, text) => {
                console.log(`[MockEditor] Insert: ${JSON.stringify(text)}`);
            }
        };
        await callback(editBuilder);
        return true;
    }
};

class MockRange {
    constructor(start, end) {
        this.start = start;
        this.end = end;
    }
}

class WorkspaceEditMock {
    constructor() {
        this.edits = [];
    }
    insert(uri, position, text) {
        this.edits.push({ type: 'insert', uri, position, text });
        console.log(`[WorkspaceEdit] Insert at ${JSON.stringify(position)}: ${JSON.stringify(text)}`);
    }
    delete(uri, range) {
        this.edits.push({ type: 'delete', uri, range });
        console.log(`[WorkspaceEdit] Delete at range: ${JSON.stringify(range)}`);
    }
}

const vscodeMock = {
    WorkspaceEdit: WorkspaceEditMock,
    Range: MockRange,
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
        _commands: new Map(),
        registerCommand: (command, callback) => {
            console.log(`[VSCode] Registered command: ${command}`);
            vscodeMock.commands._commands.set(command, callback);
            return { dispose: () => { } };
        },
        executeCommand: async (command) => {
            console.log(`[VSCode] Executing command: ${command}`);
            if (vscodeMock.commands._commands.has(command)) {
                await vscodeMock.commands._commands.get(command)();
            }
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

    if (vscodeMock.commands._commands.has('promqueen.runPipeline')) {
        console.log("Executing promqueen.runPipeline...");
        try {
            await vscodeMock.commands._commands.get('promqueen.runPipeline')();
            console.log("Command finished successfully.");
        } catch (e) {
            console.error("Command failed:", e);
        }
    } else {
        console.error("promqueen.runPipeline command not registered!");
    }
}

runTest();
