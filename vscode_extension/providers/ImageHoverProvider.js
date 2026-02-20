const vscode = require('vscode');

class ImageHoverProvider {
    provideHover(document, position, _token) {
        const range = document.getWordRangeAtPosition(position, /!\[.*?\]\(.*?\)/);
        if (range) {
            const text = document.getText(range);
            // Extract URL from markdown image syntax: ![alt](url)
            const match = text.match(/!\[.*?\]\((.*?)\)/);
            if (match && match[1]) {
                const imageUrl = match[1];

                // Create MarkdownString with HTML support
                const md = new vscode.MarkdownString();
                md.supportHtml = true;
                md.isTrusted = true; // Required for links/commands

                // Use HTML for resizing and wrapping in a link for clickability.
                // We use a reasonable max-width to simulate "approx 25% screen width" behavior 
                // which is often around 300-400px in typical editors, though percentage isn't directly supported well in all markdown renderers without CSS.
                // However, VS Code builtin markdown likely uses a max-width style. 
                // We will use `width` attribute on img tag.
                // Wrapping in an anchor tag <a> makes it clickable.

                md.appendMarkdown(`[<img src="${imageUrl}" width="300"/>](${imageUrl})`);

                return new vscode.Hover(md);
            }
        }
        return null;
    }
}

module.exports = {
    ImageHoverProvider
};
