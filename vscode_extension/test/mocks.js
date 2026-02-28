const path = require('path');

// --- Mock Classes ---

class MockRange {
    constructor(start, end) {
        this.start = start;
        this.end = end;
    }
}

class MockWorkspaceEdit {
    constructor() {
        this.edits = [];
    }
    delete(uri, range) {
        this.edits.push({ type: 'delete', uri, range });
    }
    insert(uri, position, text) {
        this.edits.push({ type: 'insert', uri, position, text });
    }
}

class MockCompletionItem {
    constructor(label, kind) {
        this.label = label;
        this.kind = kind;
    }
}

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

class MockDocument {
    constructor(text, uri) {
        this.text = text || "";
        this.uri = uri || { fsPath: path.resolve(__dirname, '../../test_file.txt') };
        this.lineCount = this.text.split('\n').length;
    }

    getText(range) {
        if (!range) return this.text;
        // Simple implementation: if range provided, return substring (simplified)
        // For accurate range extraction, we'd need to map line/char to offset
        // But most tests just call getText() or verify content
        return this.text;
    }

    lineAt(indexOrPos) {
        const index = typeof indexOrPos === 'object' ? indexOrPos.line : indexOrPos;
        const lines = this.text.split('\n');
        const lineText = (lines[index] || "").replace(/\r$/, '');
        return {
            text: lineText,
            range: {
                start: { line: index, character: 0 },
                end: { line: index, character: lineText.length }
            }
        };
    }

    positionAt(offset) {
        const lines = this.text.split('\n');
        let currentOffset = 0;
        for (let i = 0; i < lines.length; i++) {
            const lineLength = lines[i].length + 1; // +1 for newline
            if (currentOffset + lineLength > offset) {
                return { line: i, character: offset - currentOffset };
            }
            currentOffset += lineLength;
        }
        return { line: lines.length, character: 0 };
    }

    offsetAt(position) {
        const lines = this.text.split('\n');
        let offset = 0;
        for (let i = 0; i < position.line; i++) {
            offset += lines[i].length + 1;
        }
        offset += position.character;
        return offset;
    }

    async save() { return true; }

    getWordRangeAtPosition(position, regex) {
        const line = (this.text.split('\n')[position.line] || '').replace(/\r$/, '');
        if (!regex || !line) return;

        const re = new RegExp(regex.source, regex.flags + (regex.flags.includes('g') ? '' : 'g'));
        let match;
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

// --- Setup Function ---

function setupVscodeMock(customOverrides = {}) {
    const commandsMap = new Map();

    const defaultVscodeMock = {
        Range: MockRange,
        WorkspaceEdit: MockWorkspaceEdit,
        CompletionItem: MockCompletionItem,
        CompletionItemKind: { Keyword: 13 },
        MarkdownString: MockMarkdownString,
        Hover: MockHover,

        ViewColumn: { Beside: 2 },

        window: {
            activeTextEditor: customOverrides.editorMock || {
                document: new MockDocument(""),
                edit: async (cb) => {
                    const editBuilder = {
                        delete: (_range) => { },
                        insert: (_pos, _text) => { }
                    };
                    await cb(editBuilder);
                    return true;
                }
            },
            showErrorMessage: (msg) => { throw new Error('[VSCode Error] ' + msg); },
            showInformationMessage: (_msg) => { },
            showTextDocument: async (doc) => doc,
            createWebviewPanel: () => ({
                webview: { html: '' },
                title: '',
                reveal: () => {},
                onDidDispose: () => ({ dispose: () => {} })
            }),
            onDidChangeActiveTextEditor: () => ({ dispose: () => {} })
        },

        workspace: {
            getWorkspaceFolder: () => ({ uri: { fsPath: path.resolve(__dirname, '../../') } }),
            getConfiguration: () => ({ get: (_key, defaultValue) => defaultValue }),
            applyEdit: async (_edit) => true,
            openTextDocument: async (opts) => opts,
            onDidChangeTextDocument: () => ({ dispose: () => {} })
        },

        languages: {
            registerHoverProvider: () => ({ dispose: () => { } }),
            registerCompletionItemProvider: () => ({ dispose: () => { } })
        },

        commands: {
            _commands: commandsMap,
            registerCommand: (command, callback) => {
                commandsMap.set(command, callback);
                return { dispose: () => { } };
            },
            executeCommand: async (command, ...args) => {
                if (commandsMap.has(command)) {
                    return await commandsMap.get(command)(...args);
                }
            }
        }
    };

    // Deep merge or just shallow merge top-level keys? 
    // Mocks are usually simple, let's do shallow merge of top-level but careful with nested objects if needed.
    // Actually, let's just use Object.assign for top level, but for nested like 'window', we might want to merge.
    // For now, let's rely on the user passing specific overrides or modifying the returned object.
    const vscodeMock = Object.assign({}, defaultVscodeMock);

    // Apply overrides
    if (customOverrides.window) Object.assign(vscodeMock.window, customOverrides.window);
    if (customOverrides.workspace) Object.assign(vscodeMock.workspace, customOverrides.workspace);
    if (customOverrides.languages) Object.assign(vscodeMock.languages, customOverrides.languages);
    if (customOverrides.commands) {
        // Special handling for commands if we want to preserve the map logic
        // But usually overrides replace the whole thing. 
        // If user provided commands object, use it, otherwise keep default.
        vscodeMock.commands = customOverrides.commands;
    }

    // Also copy any other top-level overrides
    for (const key in customOverrides) {
        if (!['window', 'workspace', 'languages', 'commands'].includes(key)) {
            vscodeMock[key] = customOverrides[key];
        }
    }

    // Intercept require
    const Module = require('module');
    const originalRequire = Module.prototype.require;
    Module.prototype.require = function (request) {
        if (request === 'vscode') {
            return vscodeMock;
        }
        return originalRequire.apply(this, arguments);
    };

    return vscodeMock;
}

module.exports = {
    setupVscodeMock,
    MockDocument,
    MockRange,
    MockWorkspaceEdit,
    MockCompletionItem,
    MockMarkdownString,
    MockHover
};
