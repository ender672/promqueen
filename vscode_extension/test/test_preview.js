const Module = require('module');
const path = require('path');
const fs = require('fs');
const assert = require('assert');



const { setupVscodeMock, MockDocument } = require('./mocks');

const vscodeMock = setupVscodeMock();

// Helper to set up active document
vscodeMock.window.activeTextEditor = {
    document: new MockDocument("---\nfoo: bar\n---\nUser: Hello\n"),
    edit: async (callback) => {
        const editBuilder = {
            insert: (pos, text) => { }
        };
        await callback(editBuilder);
        return true;
    }
};


// --- Mock Fetch (for rptoprompt dependencies if any) ---
// rptoprompt might use fetch but usually it's mostly logic.
// However sendPrompt uses fetch. existing run_test mocks it.
// The preview command runs rptoprompt but NOT sendPrompt.
// But some imports might trigger things.

// --- Run Test ---
async function runTest() {


    // Load extension
    const extension = require('../dist/extension.js');
    extension.activate({ subscriptions: [] });

    if (vscodeMock.commands._commands.has('promqueen.previewPrompt')) {

        try {
            await vscodeMock.commands.executeCommand('promqueen.previewPrompt');

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
