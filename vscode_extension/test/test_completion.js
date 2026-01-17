const Module = require('module');
const assert = require('assert');

const { setupVscodeMock, MockDocument } = require('./mocks');

const vscodeMock = setupVscodeMock();


// --- Run Test ---
const { CompletionProvider } = require('../providers/CompletionProvider');

async function test() {
    const provider = new CompletionProvider();

    // Test Case 1: Basic Extraction & Order
    const text1 = `
@system
System prompt

@user
User prompt 1

@assistant
Assistant response

@user
User prompt 2
`;
    // Order should be: user (most recent), assistant, system.
    // "user" appears last, so it's first in suggestions.
    // "assistant" appears before that.
    // "system" appears first.

    // Position: We are typing "@" at the start of a new line.
    // Let's say at the end.
    const doc1 = new MockDocument(text1);
    const pos1 = { line: 10, character: 1 }; // Line 10 doesn't exist really, but we just need lineAt to work for the check.
    // However, the provider checks `document.lineAt(position).text.substr(0, position.character)`.
    // If we are typing "@", line text is likely "@". position is char 1.
    // We need to mock lineAt to return "@" for the current line.

    // We can just add a line to our mock text or handle it in MockDocument.
    // Let's create a doc that HAS the trigger line.
    const textWithTrigger = text1 + "\n@";
    const docTrigger = new MockDocument(textWithTrigger);
    const lines = textWithTrigger.split('\n');
    const lastLineIdx = lines.length - 1;
    const posTrigger = { line: lastLineIdx, character: 1 };

    const items1 = provider.provideCompletionItems(docTrigger, posTrigger, null, null);

    assert(items1, "Should return items");

    // Updated Logic: "It's not favorable to repeat the same name twice."
    // Last role was 'user'. Previous to that 'assistant'. Previous to that 'user'. Previous 'system'.
    // Document:
    // ...
    // @user
    // User prompt 2
    // @<trigger>

    // The role immediately before the trigger is 'user'.
    // So 'user' should be filtered out.
    // Remaining history candidates: 'assistant', 'system'.
    // 'assistant' is more recent than 'system'.

    assert.strictEqual(items1.length, 2, "Should have 2 unique roles (filtered 'user')");

    assert.strictEqual(items1[0].label, 'assistant', "1st suggestion should be 'assistant' ('user' filtered)");
    assert.strictEqual(items1[1].label, 'system', "2nd suggestion should be 'system'");

    // Verify sortText
    // "00000", "00001"
    assert.strictEqual(items1[0].sortText, '00000');
    assert.strictEqual(items1[1].sortText, '00001');


    // Test Case 2: Not starting with @
    // If line is " @", it shouldn't trigger (based on our impl: startsWith('@'))
    // Wait, the impl used `document.lineAt(position).text.substr(0, position.character).startsWith('@')`
    // If I type " @" (space then @), substr is " @". startsWith('@') is false. Correct.
    const textNoTrigger = text1 + "\n @";
    const docNoTrigger = new MockDocument(textNoTrigger);
    const posNoTrigger = { line: lines.length, character: 2 }; // " @" is 2 chars
    const items2 = provider.provideCompletionItems(docNoTrigger, posNoTrigger, null, null);

    assert.strictEqual(items2, undefined, "Should not provide items if line doesn't start with @");
}

try {
    test();
} catch (e) {
    console.error("Test Failed:", e);
    process.exit(1);
}
