const vscode = require('vscode');

class CompletionProvider {
    /**
     * @param {vscode.TextDocument} document 
     * @param {vscode.Position} position 
     * @param {vscode.CancellationToken} token 
     * @param {vscode.CompletionContext} context 
     */
    provideCompletionItems(document, position, token, context) {
        // limit to lines that start with @
        // The trigger character is @, but the user might have continued typing.
        // We check if the line up to cursor starts with @
        const linePrefix = document.lineAt(position).text.substr(0, position.character);
        // trimStart to allow indentation?
        // User request: "starts a line with @"
        // Usually implies ^@ or ^\s*@.
        // But the previous conversation and file format implies ^@ (no indentation for roles).
        if (!linePrefix.startsWith('@')) {
            return undefined;
        }

        const text = document.getText();
        // Regex to find all roles in the document
        // Assumes role definition is "^@name"
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
        } catch (e) {
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
            // We provide the name without '@' because the user has already typed '@' 
            // and we want to complete the name part.
            // VS Code typically handles the replacement range.
            // However, since @ is a trigger char, we must ensure we don't duplicate it.
            // If the user typed "@", and we suggest "system", inserting "system" results in "@system".

            const item = new vscode.CompletionItem(role, vscode.CompletionItemKind.Keyword);

            // "000", "001", etc. to enforce order
            item.sortText = index.toString().padStart(5, '0');

            // Optional: add a detail text
            item.detail = "Role Name (History)";

            return item;
        });
    }
}

module.exports = {
    CompletionProvider
};
