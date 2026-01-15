const Module = require('module');
const path = require('path');
const assert = require('assert');

// --- Mock VS Code ---
class MockWorkspaceEdit {
    constructor() {
        this.edits = [];
    }
    delete(uri, range) {
        this.edits.push({ type: 'delete', uri, range });
        console.log(`[WorkspaceEdit] Delete at range: Start(${range.start.line}, ${range.start.character}) - End(${range.end.line}, ${range.end.character})`);
    }
    insert(uri, position, text) {
        this.edits.push({ type: 'insert', uri, position, text });
        // console.log(`[WorkspaceEdit] Insert at ${JSON.stringify(position)}: ${JSON.stringify(text)}`);
    }
}

class MockRange {
    constructor(start, end) {
        this.start = start;
        this.end = end;
    }
}

const documentText = `---
roleplay_user: user
---

@user
Hello

@assistant
Hi there!`;

const documentMock = {
    uri: { fsPath: path.resolve(__dirname, '../../test_file.txt') },
    getText: () => documentText,
    lineCount: 8,
    lineAt: (index) => ({ range: { end: { line: index, character: 0 } } }),
    positionAt: (offset) => {
        // Simple mock positionAt for our specific text
        // Text length is roughly:
        // --- (3) + \n (1) + roleplay_user: user (19) + \n (1) + --- (3) + \n (1) = 28
        // \n (1) + @user (5) + \n (1) + Hello (5) = 12
        // \n\n (2) + @assistant (10) + \n (1) + Hi there! (9) = 22
        // Total ~ 62 chars

        // We really only care about it returning *something* consistent
        return { line: 0, character: offset };
    }
};

const editorMock = {
    document: documentMock,
};

const vscodeMock = {
    WorkspaceEdit: MockWorkspaceEdit,
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
            // Check if we have the delete edit we expect
            const deleteEdit = edit.edits.find(e => e.type === 'delete');
            if (deleteEdit) {
                vscodeMock._lastEdit = deleteEdit; // Store for verification outside
                console.log(`VERIFICATION: Delete edit FOUND. Range: ${deleteEdit.range.start.character} to ${deleteEdit.range.end.character}`);
            }
            return true;
        }
    },
    commands: {
        registerCommand: (command, callback) => {
            console.log(`[VSCode] Registered command: ${command}`);
            vscodeMock.commands[command] = callback;
            return { dispose: () => { } };
        },
        executeCommand: async (command) => {
            console.log(`[VSCode] Executing command: ${command}`);
            if (command === 'promqueen.runPipeline') {
                console.log("VERIFICATION: Pipeline triggered CORRECTLY.");
                // We don't need to actually run the pipeline for this test, just verify it was called
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

// --- Run Test ---
async function runTest() {
    console.log("=== Starting Regenerate Command Test ===");

    // Load extension
    const extension = require('../extension.js');
    extension.activate({ subscriptions: [] });

    // Execute the command - Test Case 1: Normal last message
    console.log("--- Test Case 1: Normal last message ---");
    if (vscodeMock.commands['promqueen.regenerateLastMessage']) {
        await vscodeMock.commands['promqueen.regenerateLastMessage']();
    } else {
        console.error("Command promqueen.regenerateLastMessage not registered!");
        process.exit(1);
    }

    // --- Test Case 2: Trailing Empty Role ---
    console.log("--- Test Case 2: Trailing Empty Role ---");
    // Setup new document text
    // ... @user\nMessage\n\n@assistant\n (empty role)
    const textCase2 = `---
roleplay_user: user
---

@user
Do something

@assistant
`;
    // Last index of \n\n@ is before @assistant.
    // Logic should see @assistant is empty.
    // Should find previous \n\n@ ... wait, first message usually doesn't have \n\n@ if it follows YAML directly?
    // In our mock text above: `\n\n@user` -> yes.
    // So it should delete from `\n\n@user` onwards.

    // override getText for second pass
    documentMock.getText = () => textCase2;
    // Reset edits
    vscodeMock._lastEdit = null;

    await vscodeMock.commands['promqueen.regenerateLastMessage']();
}

runTest();
