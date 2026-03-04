const assert = require('assert');

const { setupVscodeMock, MockDocument } = require('./mocks');

setupVscodeMock();

const { CompletionProvider } = require('../providers/CompletionProvider');
const { FRONTMATTER_SCHEMA } = require('../providers/frontmatterSchema');

async function test() {
    const provider = new CompletionProvider();

    // Test Case 1: Cursor inside frontmatter suggests keys
    const text1b = `---
api_url: https://example.com

---
@system
Hello`;

    const doc1b = new MockDocument(text1b);
    // Cursor on line 2 (the blank line), character 0
    const pos1 = { line: 2, character: 0 };
    const items1 = provider.provideCompletionItems(doc1b, pos1, null, null);

    assert(items1, 'Should return frontmatter suggestions');
    assert(items1.length > 0, 'Should have at least one suggestion');

    // api_url is already present, so it should be filtered out
    const apiUrlItem = items1.find(item => item.label === 'api_url');
    assert.strictEqual(apiUrlItem, undefined, 'api_url should be filtered out (already present)');

    // roleplay_user should be present
    const roleplayItem = items1.find(item => item.label === 'roleplay_user');
    assert(roleplayItem, 'roleplay_user should be suggested');
    assert.strictEqual(roleplayItem.kind, 9, 'Kind should be Property (9)');
    assert(roleplayItem.documentation, 'Should have documentation');
    assert(roleplayItem.documentation.value.includes('user/player character'), 'Documentation should contain description');
    assert.strictEqual(roleplayItem.insertText, 'roleplay_user: ', 'insertText should include colon and space');

    // Test Case 2: Cursor outside frontmatter returns no frontmatter suggestions
    const pos2 = { line: 4, character: 0 }; // line 4 is "@system"
    const items2 = provider.provideCompletionItems(doc1b, pos2, null, null);
    // Outside frontmatter, at start of line without @, should return undefined
    assert.strictEqual(items2, undefined, 'Should not return frontmatter suggestions outside frontmatter');

    // Test Case 3: No frontmatter block at all
    const text3 = `@system
Hello`;
    const doc3 = new MockDocument(text3);
    const pos3 = { line: 0, character: 0 };
    // Line starts with @, so it returns role suggestions, not frontmatter
    const items3 = provider.provideCompletionItems(doc3, pos3, null, null);
    // This should fall through to role suggestions (starts with @)
    // Just verify it doesn't crash and doesn't return frontmatter items
    if (items3) {
        const hasFrontmatterKey = items3.some(item => item.kind === 9);
        assert.strictEqual(hasFrontmatterKey, false, 'Should not have frontmatter suggestions without frontmatter block');
    }

    // Test Case 4: All keys filtered when all present
    const allKeysText = '---\n' +
        FRONTMATTER_SCHEMA.map(e => e.key + ': value').join('\n') +
        '\n\n---\n@system\nHello';
    const docAll = new MockDocument(allKeysText);
    // Find the blank line (it's after all the keys, before ---)
    const allLines = allKeysText.split('\n');
    const blankLineIdx = allLines.indexOf('');
    const posAll = { line: blankLineIdx, character: 0 };
    const itemsAll = provider.provideCompletionItems(docAll, posAll, null, null);

    assert(itemsAll, 'Should return items array');
    assert.strictEqual(itemsAll.length, 0, 'All keys present, should return empty array');

    // Test Case 5: Indented lines (YAML values) should not trigger suggestions
    const text5 = `---
api_call_props:
  model: gpt-4
---
@system
Hello`;
    const doc5 = new MockDocument(text5);
    const pos5 = { line: 2, character: 2 }; // "  model: gpt-4", indented
    const items5 = provider.provideCompletionItems(doc5, pos5, null, null);
    assert.strictEqual(items5, undefined, 'Should not suggest on indented lines');

    // Test Case 6: sortText preserves schema order
    const text6 = `---

---
@system
Hello`;
    const doc6 = new MockDocument(text6);
    const pos6 = { line: 1, character: 0 };
    const items6 = provider.provideCompletionItems(doc6, pos6, null, null);
    assert(items6, 'Should return items');
    assert.strictEqual(items6.length, FRONTMATTER_SCHEMA.length, 'Should suggest all keys');
    assert.strictEqual(items6[0].sortText, '00000');
    assert.strictEqual(items6[1].sortText, '00001');
}

try {
    test();
} catch (e) {
    console.error('Test Failed:', e);
    process.exit(1);
}
