const vscode = require('vscode');
const path = require('path');
const pqutils = require('../../lib/pqutils.js');

class CompletionProvider {
    /**
     * @param {vscode.TextDocument} document 
     * @param {vscode.Position} position 
     * @param {vscode.CancellationToken} token 
     * @param {vscode.CompletionContext} context 
     */
    provideCompletionItems(document, position, _token, _context) {
        const linePrefix = document.lineAt(position).text.substr(0, position.character);

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

    provideDecoratorSuggestions(document) {
        const text = document.getText();
        let config = {};

        try {
            const parsed = pqutils.parseConfigAndMessages(text);

            let projectRoot;
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
        const decoratorsMap = config.roleplay_prompt_decorators || {};
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
        const text = document.getText();
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
        let previousRoleName = null;
        try {
            const lineStartOffset = document.offsetAt(document.lineAt(position).range.start);

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
