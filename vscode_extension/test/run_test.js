const Module = require('module');
const path = require('path');
const fs = require('fs');



const { setupVscodeMock, MockDocument } = require('./mocks');

const vscodeMock = setupVscodeMock();

// Helper to set up active document
vscodeMock.window.activeTextEditor = {
    document: new MockDocument("---\nfoo: bar\n---\nUser: Hello\n"),
    edit: async (callback) => {
        const editBuilder = {
            insert: (pos, text) => { },
            delete: (range) => { }
        };
        await callback(editBuilder);
        return true;
    }
};


// --- Mock Fetch for SendPrompt ---
global.fetch = async (url, options) => {

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


    // Load extension
    const extension = require('../dist/extension.js');
    extension.activate({ subscriptions: [] });

    if (vscodeMock.commands._commands.has('promqueen.runPipeline')) {

        try {
            await vscodeMock.commands.executeCommand('promqueen.runPipeline');

        } catch (e) {
            console.error("Command failed:", e);
        }
    } else {
        console.error("promqueen.runPipeline command not registered!");
    }
}

runTest();
