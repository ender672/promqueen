const path = require('path');

const { setupVscodeMock, MockDocument } = require('./mocks');

// Setup mock with spy
let openTextDocumentSpy = null;
const vscodeMock = setupVscodeMock({
    workspace: {
        getWorkspaceFolder: () => ({ uri: { fsPath: path.resolve(__dirname, '../../') } }),
        openTextDocument: async (opts) => {
            openTextDocumentSpy = opts;
            return opts;
        }
    }
});

// Helper to set up active document
vscodeMock.window.activeTextEditor = {
    document: new MockDocument("---\ndot_config_loading: false\nfoo: bar\n---\nUser: Hello\n"),
    edit: async (callback) => {
        const editBuilder = {
            insert: (_pos, _text) => { }
        };
        await callback(editBuilder);
        return true;
    }
};

async function runTest() {
    // Load extension
    const extension = require('../dist/extension.js');
    extension.activate({ subscriptions: [] });

    if (vscodeMock.commands._commands.has('promqueen.previewPrompt')) {
        try {
            await vscodeMock.commands.executeCommand('promqueen.previewPrompt');

            // Check the spy
            if (!openTextDocumentSpy) {
                console.error("FAILED: openTextDocument was not called");
                process.exit(1);
            }

            // Verify language ID
            if (openTextDocumentSpy.language !== 'promqueen-pqueen') {
                console.error(`FAILED: Expected language 'promqueen-pqueen', got '${openTextDocumentSpy.language}'`);
                process.exit(1);
            }

        } catch (e) {
            console.error("Command failed:", e);
            process.exit(1);
        }
    } else {
        console.error("promqueen.previewPrompt command not registered!");
        process.exit(1);
    }

    // --- Test Case 2: CRLF line endings ---

    openTextDocumentSpy = null;
    vscodeMock.window.activeTextEditor.document = new MockDocument("---\r\ndot_config_loading: false\r\nfoo: bar\r\n---\r\nUser: Hello\r\n");

    try {
        await vscodeMock.commands.executeCommand('promqueen.previewPrompt');

        if (!openTextDocumentSpy) {
            console.error("FAILED: Case 2 (CRLF) openTextDocument was not called");
            process.exit(1);
        }

        if (openTextDocumentSpy.language !== 'promqueen-pqueen') {
            console.error(`FAILED: Case 2 (CRLF) Expected language 'promqueen-pqueen', got '${openTextDocumentSpy.language}'`);
            process.exit(1);
        }

    } catch (e) {
        console.error("Case 2 (CRLF) Command failed:", e);
        process.exit(1);
    }
}

runTest();
