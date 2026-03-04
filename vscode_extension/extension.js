const vscode = require('vscode');
const { registerPipelineCommands } = require('./commands/pipeline');
const { registerPreviewCommands } = require('./commands/previews');
const { registerRegenerateCommand } = require('./commands/regenerate');
const { registerHtmlPreviewCommands, deactivate: deactivateHtmlPreview } = require('./commands/htmlPreview');
const { ImageHoverProvider } = require('./providers/ImageHoverProvider');
const { FrontmatterHoverProvider } = require('./providers/FrontmatterHoverProvider');
const { CompletionProvider } = require('./providers/CompletionProvider');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    registerPipelineCommands(context);
    registerPreviewCommands(context);
    registerRegenerateCommand(context);
    registerHtmlPreviewCommands(context);

    context.subscriptions.push(
        vscode.languages.registerHoverProvider('promqueen-pqueen', new ImageHoverProvider())
    );
    context.subscriptions.push(
        vscode.languages.registerHoverProvider('promqueen-pqueen', new FrontmatterHoverProvider())
    );
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider('promqueen-pqueen', new CompletionProvider(), '@', '[', ':')
    );
}

function deactivate() {
    deactivateHtmlPreview();
}

module.exports = { activate, deactivate };
