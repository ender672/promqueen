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

    }
    insert(uri, position, text) {
        this.edits.push({ type: 'insert', uri, position, text });
        // log(`[WorkspaceEdit] Insert at ${JSON.stringify(position)}: ${JSON.stringify(text)}`);
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
    edit: async (callback, options) => {

        const editBuilder = {
            delete: (range) => {

                // Store for verification
                vscodeMock._lastEdit = { type: 'delete', range };

            },
            insert: (position, text) => {

            }
        };
        await callback(editBuilder);
        return true;
    }
};

const vscodeMock = {
    WorkspaceEdit: MockWorkspaceEdit,
    Range: MockRange,
    window: {
        activeTextEditor: editorMock,
        showErrorMessage: (msg) => console.error('[VSCode Error]', msg),
        showInformationMessage: (msg) => { }
    },
    workspace: {
        getWorkspaceFolder: () => ({ uri: { fsPath: path.resolve(__dirname, '../../') } }),
        applyEdit: async (edit) => {

            // Check if we have the delete edit we expect
            const deleteEdit = edit.edits.find(e => e.type === 'delete');
            if (deleteEdit) {
                vscodeMock._lastEdit = deleteEdit; // Store for verification outside

            }
            return true;
        }
    },
    languages: {
        registerHoverProvider: (selector, provider) => {

            return { dispose: () => { } };
        }
    },
    commands: {
        registerCommand: (command, callback) => {

            vscodeMock.commands[command] = callback;
            return { dispose: () => { } };
        },
        executeCommand: async (command) => {

            if (command === 'promqueen.runPipeline') {

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


    // Load extension
    const extension = require('../dist/extension.js');
    extension.activate({ subscriptions: [] });

    // Execute the command - Test Case 1: Normal last message

    if (vscodeMock.commands['promqueen.regenerateLastMessage']) {
        await vscodeMock.commands['promqueen.regenerateLastMessage']();

        // Assertions for Case 1
        // text: ...\n\n@assistant\nHi there!
        // last delimiter index = text.lastIndexOf('\n\n@') -> points to before @assistant
        // roleNewline -> \n after @assistant
        // startIndex -> roleNewline + 1
        // We expect deletion to START after "@assistant\n"
        // Let's verify exactly.
        const case1Text = documentText;
        const lastDelim = case1Text.lastIndexOf('\n\n@');
        const roleNewline = case1Text.indexOf('\n', lastDelim + 3); // +3 for \n\n@
        const expectedStart = roleNewline + 1;
        const expectedEnd = case1Text.length;

        if (vscodeMock._lastEdit) {
            const range = vscodeMock._lastEdit.range;
            if (range.start.character !== expectedStart) {
                console.error(`FAIL: Expected start ${expectedStart}, got ${range.start.character}`);
                process.exit(1);
            }
            if (range.end.character !== expectedEnd) {
                console.error(`FAIL: Expected end ${expectedEnd}, got ${range.end.character}`);
                process.exit(1);
            }

        } else {
            console.error("FAIL: No delete edit found.");
            process.exit(1);
        }

    } else {
        console.error("Command promqueen.regenerateLastMessage not registered!");
        process.exit(1);
    }

    // --- Test Case 2: Trailing Empty Role ---

    // Setup new document text
    // ... @user\nMessage\n\n@assistant\n (empty role)
    const textCase2 = `---
roleplay_user: user
---

@user
Do something

@assistant
`;
    // Logic:
    // lastIndex (@assistant) is empty.
    // Backtracks to prevIndex (@user).
    // Should preserve @user role line.
    // START deletion after `@user\n`.
    // END deletion at `text.length` (deletes user message AND empty assistant role).

    // override getText for second pass
    documentMock.getText = () => textCase2;
    // Reset edits
    vscodeMock._lastEdit = null;

    await vscodeMock.commands['promqueen.regenerateLastMessage']();

    // Assertions for Case 2
    const lastDelim2 = textCase2.lastIndexOf('\n\n@', textCase2.length - 15); // Skip the last one (@assistant)
    // Actually our code uses lastIndexOf(delimiter, lastIndex - 1)
    const lastIndex2 = textCase2.lastIndexOf('\n\n@');
    const prevIndex2 = textCase2.lastIndexOf('\n\n@', lastIndex2 - 1);

    // We expect start after @user\n
    const roleNewline2 = textCase2.indexOf('\n', prevIndex2 + 3);
    const expectedStart2 = roleNewline2 + 1;
    const expectedEnd2 = textCase2.length;

    if (vscodeMock._lastEdit) {
        const range = vscodeMock._lastEdit.range;
        if (range.start.character !== expectedStart2) {
            console.error(`FAIL: Case 2 Expected start ${expectedStart2}, got ${range.start.character}`);
            process.exit(1);
        }
        if (range.end.character !== expectedEnd2) {
            console.error(`FAIL: Case 2 Expected end ${expectedEnd2}, got ${range.end.character}`);
            process.exit(1);
        }

    } else {
        console.error("FAIL: Case 2 No delete edit found.");
        process.exit(1);
    }
}

runTest();
