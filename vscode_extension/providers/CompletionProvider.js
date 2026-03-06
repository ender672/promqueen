const vscode = require('vscode');
const path = require('path');
const pqutils = require('../../lib/pq-utils.js');
const { FRONTMATTER_SCHEMA } = require('./frontmatterSchema.js');

class CompletionProvider {
    /**
     * @param {vscode.TextDocument} document 
     * @param {vscode.Position} position 
     * @param {vscode.CancellationToken} token 
     * @param {vscode.CompletionContext} context 
     */
    provideCompletionItems(document, position, _token, _context) {
        const linePrefix = document.lineAt(position).text.substr(0, position.character);

        // Frontmatter key suggestions
        const frontmatterRange = this.getFrontmatterRange(document);
        if (frontmatterRange && position.line > frontmatterRange.start && position.line < frontmatterRange.end) {
            return this.provideFrontmatterSuggestions(document, position, frontmatterRange);
        }

        // Decorator suggestions: Check if we are inside a decorator block
        // Matches: @RoleName [PartialDecorator
        if (/^@.+ \[[^\]]*$/.test(linePrefix)) {
            return this.provideDecoratorSuggestions(document);
        }

        // Role suggestions: Check if line starts with @
        if (linePrefix.startsWith('@')) {
            return this.provideRoleSuggestions(document, position);
        }

        return undefined;
    }

    getFrontmatterRange(document) {
        if (document.lineAt(0).text.trim() !== '---') {
            return null;
        }
        for (let i = 1; i < document.lineCount; i++) {
            if (document.lineAt(i).text.trim() === '---') {
                return { start: 0, end: i };
            }
        }
        return null;
    }

    provideFrontmatterSuggestions(document, position, frontmatterRange) {
        // Collect keys already present in the frontmatter
        const presentKeys = new Set();
        for (let i = frontmatterRange.start + 1; i < frontmatterRange.end; i++) {
            const lineText = document.lineAt(i).text;
            const match = lineText.match(/^(\w[\w_]*):/);
            if (match) {
                presentKeys.add(match[1]);
            }
        }

        // Only suggest when the cursor is at a key position (start of line, not indented)
        const linePrefix = document.lineAt(position).text.substr(0, position.character);
        if (/^\s+/.test(linePrefix)) {
            return undefined;
        }

        const items = [];
        for (const entry of FRONTMATTER_SCHEMA) {
            if (presentKeys.has(entry.key)) {
                continue;
            }

            const item = new vscode.CompletionItem(entry.key, vscode.CompletionItemKind.Property);
            item.detail = entry.type;

            const doc = new vscode.MarkdownString();
            doc.appendMarkdown(entry.description);
            doc.appendMarkdown(`\n\n**Type:** \`${entry.type}\`  \n**Default:** \`${entry.defaultValue}\``);
            if (entry.example) {
                doc.appendMarkdown(`\n\n\`\`\`yaml\n${entry.example}\n\`\`\``);
            }
            item.documentation = doc;

            item.insertText = entry.key + ': ';
            item.sortText = items.length.toString().padStart(5, '0');
            items.push(item);
        }

        return items;
    }

    provideDecoratorSuggestions(document) {
        const text = document.getText().replace(/\r\n/g, '\n');
        let config = {};
        let projectRoot;

        try {
            const parsed = pqutils.parseConfigAndMessages(text);

            const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
            if (workspaceFolder) {
                projectRoot = workspaceFolder.uri.fsPath;
            } else {
                projectRoot = path.dirname(document.uri.fsPath);
            }

            config = pqutils.resolveConfig(parsed.config, projectRoot);
        } catch {
            // If config parsing fails, we can't suggest decorators defined in config
            return [];
        }

        // Get decorators from config
        const decoratorsMap = pqutils.loadDecorators(config, projectRoot);
        const availableDecorators = Object.keys(decoratorsMap);

        if (availableDecorators.length === 0) {
            return [];
        }

        // Find last usage of each decorator
        const lastUsedMap = new Map();
        // Regex to match [decoratorname]
        const decoratorUsageRegex = /\[([\w\s-]+)\]/g;

        let match;
        while ((match = decoratorUsageRegex.exec(text)) !== null) {
            const decorator = match[1];
            // Update to latest index (works because we scan from start to end)
            lastUsedMap.set(decorator, match.index);
        }

        // Sort decorators: Last used (highest index) first. Never used last.
        availableDecorators.sort((a, b) => {
            const indexA = lastUsedMap.has(a) ? lastUsedMap.get(a) : -1;
            const indexB = lastUsedMap.has(b) ? lastUsedMap.get(b) : -1;
            return indexB - indexA;
        });

        return availableDecorators.map((decorator, index) => {
            const item = new vscode.CompletionItem(decorator, vscode.CompletionItemKind.Value);
            item.detail = decoratorsMap[decorator]; // Show the expansion as detail
            item.sortText = index.toString().padStart(5, '0');
            return item;
        });
    }

    provideRoleSuggestions(document, position) {
        const text = document.getText().replace(/\r\n/g, '\n');
        // Regex to find all roles in the document
        const roleRegex = /^@(.+)$/gm;

        const allMatches = [];
        let match;
        while ((match = roleRegex.exec(text)) !== null) {
            const roleName = match[1].trim();
            if (roleName) {
                // Store match info
                allMatches.push({ name: roleName, index: match.index });
            }
        }

        // Identify the "last @ line" (previous role before cursor).
        // Compute lineStartOffset from normalized text so offsets are consistent
        let previousRoleName = null;
        try {
            const lines = text.split('\n');
            let lineStartOffset = 0;
            for (let i = 0; i < position.line; i++) {
                lineStartOffset += lines[i].length + 1;
            }

            // Iterate backwards to find the first match before lineStartOffset
            for (let i = allMatches.length - 1; i >= 0; i--) {
                if (allMatches[i].index < lineStartOffset) {
                    previousRoleName = allMatches[i].name;
                    break;
                }
            }
        } catch {
            // ignore
        }

        // Filter and sort in reverse chronological order
        const uniqueRoles = new Set();
        const suggestions = [];

        // Iterate backwards
        for (let i = allMatches.length - 1; i >= 0; i--) {
            const role = allMatches[i].name;

            // Skip the previous role to avoid repetition
            if (role === previousRoleName) {
                continue;
            }

            if (!uniqueRoles.has(role)) {
                uniqueRoles.add(role);
                suggestions.push(role);
            }
        }

        // Map to CompletionItems
        return suggestions.map((role, index) => {
            const item = new vscode.CompletionItem(role, vscode.CompletionItemKind.Keyword);
            // "000", "001", etc. to enforce order
            item.sortText = index.toString().padStart(5, '0');
            item.detail = "Role Name (History)";
            return item;
        });
    }
}

module.exports = {
    CompletionProvider
};
