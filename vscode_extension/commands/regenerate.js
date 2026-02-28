const vscode = require('vscode');

function registerRegenerateCommand(context) {
    let docDisposable = vscode.commands.registerCommand('promqueen.regenerateLastMessage', async function () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('PromQueen: No active text editor.');
            return;
        }

        const document = editor.document;
        const text = document.getText();

        // Find all message delimiters (CRLF-aware: \n\n@ or \r\n\r\n@)
        const delimMatches = [...text.matchAll(/\r?\n\r?\n@/g)];

        let startIndex;

        if (delimMatches.length > 0) {
            const lastMatch = delimMatches[delimMatches.length - 1];
            const lastIndex = lastMatch.index;
            const lastDelimLen = lastMatch[0].length;

            // Check if the last "message" is just an empty role (e.g. from postcompletionlint)
            const remainingText = text.substring(lastIndex + lastDelimLen); // text after delimiter's @

            const firstNewLine = remainingText.indexOf('\n');
            let hasContent = false;

            if (firstNewLine === -1) {
                hasContent = false;
            } else {
                const contentAfterRole = remainingText.substring(firstNewLine + 1);
                if (contentAfterRole.trim().length > 0) {
                    hasContent = true;
                }
            }

            if (!hasContent) {
                // The last message is empty (just a role).
                // We want to regenerate the PREVIOUS message.
                if (delimMatches.length >= 2) {
                    const prevMatch = delimMatches[delimMatches.length - 2];
                    const prevIndex = prevMatch.index;
                    const prevDelimLen = prevMatch[0].length;
                    const roleNewline = text.indexOf('\n', prevIndex + prevDelimLen);
                    if (roleNewline !== -1) {
                        startIndex = roleNewline + 1;
                    } else {
                        startIndex = text.length;
                    }
                } else {
                    // No previous delimiter, check YAML
                    const yamlMatch = text.match(/\n---\r?\n/);
                    if (yamlMatch) {
                        startIndex = yamlMatch.index + yamlMatch[0].length;
                    } else {
                        startIndex = 0;
                    }
                }
            } else {
                // Last message has content.
                // We want to KEEP the role line.
                const roleNewline = text.indexOf('\n', lastIndex + lastDelimLen);
                if (roleNewline !== -1) {
                    startIndex = roleNewline + 1;
                } else {
                    startIndex = lastIndex; // Fallback
                }
            }
        } else {
            // No delimiter found.
            // Check for YAML
            const yamlMatch = text.match(/\n---\r?\n/);
            if (yamlMatch) {
                startIndex = yamlMatch.index + yamlMatch[0].length;
            } else {
                startIndex = text.length;
            }
        }

        if (startIndex < text.length) {
            const startPos = document.positionAt(startIndex);
            const endPos = document.positionAt(text.length);
            const range = new vscode.Range(startPos, endPos);

            await editor.edit(editBuilder => {
                editBuilder.delete(range);
            }, {
                undoStopBefore: true,
                undoStopAfter: false
            });
        }

        // Trigger the pipeline
        await vscode.commands.executeCommand('promqueen.runPipeline', { disableUndoStopBefore: true });
    });

    context.subscriptions.push(docDisposable);
}

module.exports = { registerRegenerateCommand };
