const { setupVscodeMock, MockDocument } = require('./mocks');

const documentText = `---
roleplay_user: user
---

@user
Hello

@assistant
Hi there!`;

const vscodeMock = setupVscodeMock();

// Configure specific mock behaviors for this test
vscodeMock._lastEdit = null;

// Custom Editor Mock to track edits
vscodeMock.window.activeTextEditor = {
    document: new MockDocument(documentText),
    edit: async (callback, _options) => {
        const editBuilder = {
            delete: (range) => {
                vscodeMock._lastEdit = { type: 'delete', range };
            },
            insert: (_position, _text) => { }
        };
        await callback(editBuilder);
        return true;
    }
};

// Custom Workspace behavior
vscodeMock.workspace.applyEdit = async (edit) => {
    const deleteEdit = edit.edits.find(e => e.type === 'delete');
    if (deleteEdit) {
        vscodeMock._lastEdit = deleteEdit;
    }
    return true;
};

// No need to intercept require here as setupVscodeMock does it


// --- Run Test ---
async function runTest() {


    // Load extension
    const extension = require('../dist/extension.js');
    extension.activate({ subscriptions: [] });

    // Mock runPipeline to prevent actual execution and network requests
    vscodeMock.commands._commands.set('promqueen.runPipeline', async () => { });

    const documentMock = vscodeMock.window.activeTextEditor.document; // Reference for later use

    // Execute the command - Test Case 1: Normal last message

    if (vscodeMock.commands._commands.has('promqueen.regenerateLastMessage')) {
        await vscodeMock.commands.executeCommand('promqueen.regenerateLastMessage');

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
            const startOffset = documentMock.offsetAt(range.start);
            const endOffset = documentMock.offsetAt(range.end);

            if (startOffset !== expectedStart) {
                console.error(`FAIL: Expected start ${expectedStart}, got ${startOffset} (char: ${range.start.character})`);
                process.exit(1);
            }
            if (endOffset !== expectedEnd) {
                console.error(`FAIL: Expected end ${expectedEnd}, got ${endOffset} (char: ${range.end.character})`);
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

    // override getText for second pass (this updates the document in place by creating a new one or updating text)
    // Wait, documentMock is a reference to the OLD document object if we did const documentMock = ...
    // But vscodeMock.window.activeTextEditor.document needs to be updated or documentMock updated.
    // Shared mock MockDocument stores text in this.text.
    // So we can just update this.text? No, no setter.
    // We should create a new document.
    vscodeMock.window.activeTextEditor.document = new MockDocument(textCase2);
    // update our reference
    const documentMock2 = vscodeMock.window.activeTextEditor.document;

    // Reset edits
    vscodeMock._lastEdit = null;

    await vscodeMock.commands.executeCommand('promqueen.regenerateLastMessage');

    // Assertions for Case 2
    const lastIndex2 = textCase2.lastIndexOf('\n\n@');
    const prevIndex2 = textCase2.lastIndexOf('\n\n@', lastIndex2 - 1);

    // We expect start after @user\n
    const roleNewline2 = textCase2.indexOf('\n', prevIndex2 + 3);
    const expectedStart2 = roleNewline2 + 1;
    const expectedEnd2 = textCase2.length;

    if (vscodeMock._lastEdit) {
        const range = vscodeMock._lastEdit.range;
        const startOffset2 = documentMock2.offsetAt(range.start);
        const endOffset2 = documentMock2.offsetAt(range.end);

        if (startOffset2 !== expectedStart2) {
            console.error(`FAIL: Case 2 Expected start ${expectedStart2}, got ${startOffset2}`);
            process.exit(1);
        }
        if (endOffset2 !== expectedEnd2) {
            console.error(`FAIL: Case 2 Expected end ${expectedEnd2}, got ${endOffset2}`);
            process.exit(1);
        }

    } else {
        console.error("FAIL: Case 2 No delete edit found.");
        process.exit(1);
    }

    // --- Test Case 3: CRLF line endings ---

    const textCase3 = "---\r\nroleplay_user: user\r\n---\r\n\r\n@user\r\nHello\r\n\r\n@assistant\r\nHi there!";

    vscodeMock.window.activeTextEditor.document = new MockDocument(textCase3);
    const documentMock3 = vscodeMock.window.activeTextEditor.document;

    vscodeMock._lastEdit = null;

    await vscodeMock.commands.executeCommand('promqueen.regenerateLastMessage');

    // The CRLF delimiter \r\n\r\n@ before @assistant is at the same logical position.
    // We expect deletion to START after "@assistant\r\n"
    const delimMatches3 = [...textCase3.matchAll(/\r?\n\r?\n@/g)];
    const lastMatch3 = delimMatches3[delimMatches3.length - 1];
    const roleNewline3 = textCase3.indexOf('\n', lastMatch3.index + lastMatch3[0].length);
    const expectedStart3 = roleNewline3 + 1;
    const expectedEnd3 = textCase3.length;

    if (vscodeMock._lastEdit) {
        const range = vscodeMock._lastEdit.range;
        const startOffset3 = documentMock3.offsetAt(range.start);
        const endOffset3 = documentMock3.offsetAt(range.end);

        if (startOffset3 !== expectedStart3) {
            console.error(`FAIL: Case 3 (CRLF) Expected start ${expectedStart3}, got ${startOffset3}`);
            process.exit(1);
        }
        if (endOffset3 !== expectedEnd3) {
            console.error(`FAIL: Case 3 (CRLF) Expected end ${expectedEnd3}, got ${endOffset3}`);
            process.exit(1);
        }

    } else {
        console.error("FAIL: Case 3 (CRLF) No delete edit found.");
        process.exit(1);
    }
}

runTest();
