const Module = require('module');
const path = require('path');



const { setupVscodeMock, MockDocument } = require('./mocks');

const vscodeMock = setupVscodeMock();

// Helper to set up active document
vscodeMock.window.activeTextEditor = {
    document: new MockDocument("---\nfoo: bar\n---\nUser: Hello\n\n@Assistant\nOld response"),
    edit: async (callback, options) => {
        const editBuilder = {
            insert: (pos, text) => { },
            delete: (range) => { }
        };
        await callback(editBuilder);
        return true;
    }
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

    const extension = require('../dist/extension.js');
    extension.activate({ subscriptions: [] });


    await vscodeMock.commands.executeCommand('promqueen.regenerateLastMessage');
}

runTest();
