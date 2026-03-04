const vscode = require('vscode');
const { FRONTMATTER_SCHEMA_MAP } = require('./frontmatterSchema.js');

class FrontmatterHoverProvider {
    provideHover(document, position, _token) {
        // Check line 0 is ---
        if (document.lineAt(0).text.trim() !== '---') {
            return null;
        }

        // Find closing ---
        let closingLine = -1;
        for (let i = 1; i < document.lineCount; i++) {
            if (document.lineAt(i).text.trim() === '---') {
                closingLine = i;
                break;
            }
        }

        if (closingLine === -1 || position.line <= 0 || position.line >= closingLine) {
            return null;
        }

        // Extract the key from the line
        const lineText = document.lineAt(position).text;
        const match = lineText.match(/^(\w[\w_]*):/);
        if (!match) {
            return null;
        }

        const key = match[1];
        const entry = FRONTMATTER_SCHEMA_MAP.get(key);
        if (!entry) {
            return null;
        }

        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${entry.key}**\n\n`);
        md.appendMarkdown(entry.description);
        md.appendMarkdown(`\n\n**Type:** \`${entry.type}\`  \n**Default:** \`${entry.defaultValue}\``);
        if (entry.example) {
            md.appendMarkdown(`\n\n\`\`\`yaml\n${entry.example}\n\`\`\``);
        }

        return new vscode.Hover(md);
    }
}

module.exports = { FrontmatterHoverProvider };
