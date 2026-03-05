const assert = require('assert');

const { setupVscodeMock, MockDocument, MockMarkdownString } = require('./mocks');

setupVscodeMock();

// --- Run Test ---
const { ImageHoverProvider } = require('../providers/ImageHoverProvider');

function test() {

    const provider = new ImageHoverProvider();
    const doc = new MockDocument([
        "Hello world",
        "Here is an image: ![alt text](https://example.com/img.png) end.",
        "Another line"
    ].join('\n'));

    // Test Case 1: Hover over image
    // Line 1, char 20 (inside "![alt...")
    const pos1 = { line: 1, character: 20 };
    const hover1 = provider.provideHover(doc, pos1);

    assert(hover1, "Hover should be returned");
    assert(hover1.contents instanceof MockMarkdownString);
    // New format: [<img src="https://example.com/img.png" width="300"/>](https://example.com/img.png)
    assert.strictEqual(hover1.contents.value, '[<img src="https://example.com/img.png" width="300"/>](https://example.com/img.png)');
    assert.strictEqual(hover1.contents.supportHtml, true);
    assert.strictEqual(hover1.contents.isTrusted, true);

    // Test Case 2: Hover over text
    const pos2 = { line: 0, character: 0 };
    const hover2 = provider.provideHover(doc, pos2);

    assert.strictEqual(hover2, null, "Hover should be null for regular text");

    // Test Case 3: Hover outside image on same line
    const pos3 = { line: 1, character: 0 }; // "Here"
    const hover3 = provider.provideHover(doc, pos3);
    assert.strictEqual(hover3, null, "Hover should be null outside image");

}

try {
    test();

} catch (e) {
    console.error("Test Failed:", e);
    process.exit(1);
}
