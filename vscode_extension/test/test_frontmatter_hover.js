const assert = require('assert');

const { setupVscodeMock, MockDocument } = require('./mocks');

setupVscodeMock();

const { FrontmatterHoverProvider } = require('../providers/FrontmatterHoverProvider');

async function test() {
    const provider = new FrontmatterHoverProvider();

    const text = `---
api_url: https://example.com
roleplay_user: Alice
unknown_key: value
---
@system
Hello`;

    const doc = new MockDocument(text);

    // Test Case 1: Hover on recognized key shows description
    const hover1 = provider.provideHover(doc, { line: 1, character: 0 }, null);
    assert(hover1, 'Should return hover for api_url');
    assert(hover1.contents.value.includes('api_url'), 'Hover should contain key name');
    assert(hover1.contents.value.includes('LLM API endpoint'), 'Hover should contain description');
    assert(hover1.contents.value.includes('Type'), 'Hover should contain type info');
    assert(hover1.contents.value.includes('Default'), 'Hover should contain default info');

    // Test Case 2: Hover on another recognized key
    const hover2 = provider.provideHover(doc, { line: 2, character: 0 }, null);
    assert(hover2, 'Should return hover for roleplay_user');
    assert(hover2.contents.value.includes('roleplay_user'), 'Hover should contain roleplay_user');
    assert(hover2.contents.value.includes('user/player character'), 'Hover should contain description');

    // Test Case 3: Hover on unrecognized key returns null
    const hover3 = provider.provideHover(doc, { line: 3, character: 0 }, null);
    assert.strictEqual(hover3, null, 'Should return null for unrecognized key');

    // Test Case 4: Hover outside frontmatter returns null
    const hover4 = provider.provideHover(doc, { line: 5, character: 0 }, null);
    assert.strictEqual(hover4, null, 'Should return null outside frontmatter');

    // Test Case 5: Hover on --- delimiter line returns null
    const hover5 = provider.provideHover(doc, { line: 0, character: 0 }, null);
    assert.strictEqual(hover5, null, 'Should return null on opening ---');

    const hover5b = provider.provideHover(doc, { line: 4, character: 0 }, null);
    assert.strictEqual(hover5b, null, 'Should return null on closing ---');

    // Test Case 6: No frontmatter block at all
    const doc2 = new MockDocument('@system\nHello');
    const hover6 = provider.provideHover(doc2, { line: 0, character: 0 }, null);
    assert.strictEqual(hover6, null, 'Should return null when no frontmatter block');
}

try {
    test();
} catch (e) {
    console.error('Test Failed:', e);
    process.exit(1);
}
