const assert = require('assert');

const { setupVscodeMock, MockDocument } = require('./mocks');

setupVscodeMock();


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

    // Test Case 3: Decorator Suggestions
    const textwithDecorators = `---
roleplay_prompt_decorators:
  happy: (shouting happily)
  sad: (crying)
  neutral: (plain)
---

@char [happy]
Message 1

@char [sad]
Message 2

@char [`;

    // Last used order: sad (most recent), happy (before that). neutral (never).
    // Expected suggestion order: sad, happy, neutral.

    const docDec = new MockDocument(textwithDecorators);
    // Cursor at the end of the last line: "@char ["
    const linesDec = textwithDecorators.split('\n');
    const lastLineDecIdx = linesDec.length - 1;
    const posDec = { line: lastLineDecIdx, character: 7 }; // "@char [" is 7 chars

    const items3 = provider.provideCompletionItems(docDec, posDec, null, null);

    assert(items3, "Should return items for decorators");
    assert.strictEqual(items3.length, 3, "Should suggest all 3 decorators");

    // Check order
    assert.strictEqual(items3[0].label, 'sad', "Most recent 'sad' should be first");
    assert.strictEqual(items3[1].label, 'happy', "Less recent 'happy' should be second");
    assert.strictEqual(items3[2].label, 'neutral', "Unused 'neutral' should be last");

    // Check detail
    assert.strictEqual(items3[0].detail, '(crying)', "Should show expansion in detail");

    // Test Case 4: CRLF line endings
    const textCRLF = "\r\n@system\r\nSystem prompt\r\n\r\n@user\r\nUser prompt 1\r\n\r\n@assistant\r\nAssistant response\r\n\r\n@user\r\nUser prompt 2\r\n";
    const textCRLFWithTrigger = textCRLF + "\r\n@";
    const docCRLF = new MockDocument(textCRLFWithTrigger);
    const linesCRLF = textCRLFWithTrigger.split('\n');
    const lastLineCRLFIdx = linesCRLF.length - 1;
    const posCRLF = { line: lastLineCRLFIdx, character: 1 };

    const items4 = provider.provideCompletionItems(docCRLF, posCRLF, null, null);

    assert(items4, "Case 4 (CRLF): Should return items");
    assert.strictEqual(items4.length, 2, "Case 4 (CRLF): Should have 2 unique roles (filtered 'user')");
    assert.strictEqual(items4[0].label, 'assistant', "Case 4 (CRLF): 1st suggestion should be 'assistant'");
    assert.strictEqual(items4[1].label, 'system', "Case 4 (CRLF): 2nd suggestion should be 'system'");
}

try {
    test();
} catch (e) {
    console.error("Test Failed:", e);
    process.exit(1);
}
