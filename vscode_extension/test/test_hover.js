const Module = require('module');
const assert = require('assert');

// --- Mock VS Code ---
class MockMarkdownString {
    constructor(value) {
        this.value = value || "";
        this.supportHtml = false;
        this.isTrusted = false;
    }
    appendMarkdown(val) {
        this.value += val;
    }
}

class MockHover {
    constructor(contents, range) {
        this.contents = contents;
        this.range = range;
    }
}

const vscodeMock = {
    MarkdownString: MockMarkdownString,
    Hover: MockHover
};

// Intercept require
const originalRequire = Module.prototype.require;
Module.prototype.require = function (request) {
    if (request === 'vscode') return vscodeMock;
    return originalRequire.apply(this, arguments);
};

// --- Helper: Mock Document ---
class MockDocument {
    constructor(lines) {
        this.lines = lines;
    }

    getText(range) {
        // Simple implementation: assume range is on a single line
        const line = this.lines[range.start.line];
        return line.substring(range.start.character, range.end.character);
    }

    getWordRangeAtPosition(position, regex) {
        const line = this.lines[position.line];
        if (!regex) return; // Not handling default word definition here

        // Simple regex match on the whole line to find the match that contains position
        // This is a naive implementation for testing
        // We iterate all matches and see if position is inside one
        let match;
        // Reset regex state if global
        const re = new RegExp(regex.source, regex.flags + (regex.flags.includes('g') ? '' : 'g'));

        while ((match = re.exec(line)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            if (position.character >= start && position.character <= end) {
                return {
                    start: { line: position.line, character: start },
                    end: { line: position.line, character: end }
                };
            }
        }
        return undefined;
    }
}

// --- Run Test ---
const { ImageHoverProvider } = require('../providers/ImageHoverProvider');



function test() {


    const provider = new ImageHoverProvider();
    const doc = new MockDocument([
        "Hello world",
        "Here is an image: ![alt text](https://example.com/img.png) end.",
        "Another line"
    ]);

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
