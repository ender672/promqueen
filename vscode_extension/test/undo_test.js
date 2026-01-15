const Module = require('module');
const path = require('path');

// --- Mock VS Code ---
const documentMock = {
    uri: { fsPath: path.resolve(__dirname, '../../test_file.txt') },
    getText: () => "---\nfoo: bar\n---\nUser: Hello\n\n@Assistant\nOld response",
    lineCount: 8,
    lineAt: (index) => ({ range: { end: { line: index, character: 0 } } }),
    positionAt: (offset) => ({ line: 0, character: offset }),
    lastIndexOf: (search, position) => {
        const text = "---\nfoo: bar\n---\nUser: Hello\n\n@Assistant\nOld response";
        return text.lastIndexOf(search, position);
    },
    indexOf: (search, position) => {
        const text = "---\nfoo: bar\n---\nUser: Hello\n\n@Assistant\nOld response";
        return text.indexOf(search, position);
    }
};

const editorMock = {
    document: documentMock,
    edit: async (callback, options) => {
        console.log(`[MockEditor] Edit called with options: ${JSON.stringify(options)}`);
        const editBuilder = {
            insert: (pos, text) => {
                console.log(`[MockEditor] Insert: "${text}"`);
            },
            delete: (range) => {
                console.log(`[MockEditor] Delete range`);
            }
        };
        await callback(editBuilder);
        return true;
    }
};

const vscodeMock = {
    Range: class { constructor(s, e) { this.start = s; this.end = e; } },
    window: {
        activeTextEditor: editorMock,
        showErrorMessage: (msg) => console.error('[VSCode Error]', msg),
        showInformationMessage: (msg) => console.log('[VSCode Info]', msg)
    },
    workspace: {
        getWorkspaceFolder: () => ({ uri: { fsPath: path.resolve(__dirname, '../../') } }),
        applyEdit: async (edit) => { console.log('[VSCode] applyEdit called (fallback)'); return true; }
    },
    commands: {
        _commands: new Map(),
        registerCommand: (command, callback) => {
            vscodeMock.commands._commands.set(command, callback);
            return { dispose: () => { } };
        },
        executeCommand: async (command, ...args) => {
            console.log(`[VSCode] executeCommand: ${command} args: ${JSON.stringify(args)}`);
            if (vscodeMock.commands._commands.has(command)) {
                await vscodeMock.commands._commands.get(command)(...args);
            }
        }
    },
    WorkspaceEdit: class {
        delete(uri, range) { console.log('[WorkspaceEdit] delete'); }
    }
};

const originalRequire = Module.prototype.require;
Module.prototype.require = function (request) {
    if (request === 'vscode') return vscodeMock;
    return originalRequire.apply(this, arguments);
};

// --- Mock Fetch ---
global.fetch = async (url) => ({
    ok: true,
    headers: { get: () => 'text/event-stream' },
    body: (async function* () {
        const encoder = new TextEncoder();
        yield encoder.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: "New" } }] }) + '\n\n');
        yield encoder.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: " Response" } }] }) + '\n\n');
        yield encoder.encode('data: [DONE]\n\n');
    })()
});

async function runTest() {
    console.log("=== Starting Undo Group Test ===");
    const extension = require('../extension.js');
    extension.activate({ subscriptions: [] });

    console.log(">>> Running regenerateLastMessage...");
    await vscodeMock.commands.executeCommand('promqueen.regenerateLastMessage');
}

runTest();
