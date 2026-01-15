const vscode = require('vscode');
const path = require('path');
const os = require('os');
const { precompletionLint } = require('../precompletionlint.js');
const { applyTemplate } = require('../lib/applytemplate-core.js');
const { rpToPrompt } = require('../rptoprompt.js');
const { sendPrompt } = require('../lib/sendprompt-core.js');
const { postCompletionLint } = require('../postcompletionlint.js');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    let disposable = vscode.commands.registerCommand('promqueen.runPipeline', async function () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('PromQueen: No active text editor.');
            return;
        }

        const document = editor.document;
        // Assume project root is the workspace folder containing the file, or the file's dir
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        const projectRoot = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(document.uri.fsPath);
        const templateLoaderPath = path.dirname(document.uri.fsPath);

        try {
            vscode.window.showInformationMessage('PromQueen: Starting pipeline...');

            // 1. Precompletion Lint
            let text = document.getText();
            // We pass __dirname as baseDir for config resolution in lint scripts, similar to how they are run.
            // In run_pipeline.js (located in root), it passes __dirname (root).
            // Here extension.js is in vscode_extension/.
            // But we can pass the projectRoot as the baseDir if that's what's expected for config files.
            // run_pipeline.js passes __dirname which is where run_pipeline.js is (root).
            // So we should pass the root of the repo, which is likely projectRoot.
            const preOutput = precompletionLint(text, projectRoot);

            if (preOutput) {
                const edit = new vscode.WorkspaceEdit();
                const lastLine = document.lineAt(document.lineCount - 1);
                const position = lastLine.range.end;
                edit.insert(document.uri, position, preOutput);
                await vscode.workspace.applyEdit(edit);

                // Update local text after edit
                text = document.getText();
            }

            // 2. Apply Template
            const templated = await applyTemplate(text, {
                messageTemplateLoaderPath: templateLoaderPath,
                data: {}
            }, null);

            // 3. Rp To Prompt
            const prompt = await rpToPrompt(templated, projectRoot);

            // 4. Send Prompt (Streaming)

            // Helper to sequentially queue edits
            let editQueue = Promise.resolve();
            const queueEdit = (chunk) => {
                editQueue = editQueue.then(async () => {
                    const edit = new vscode.WorkspaceEdit();
                    const lastLine = document.lineAt(document.lineCount - 1);
                    const position = lastLine.range.end;
                    edit.insert(document.uri, position, chunk);
                    await vscode.workspace.applyEdit(edit);
                });
            };

            const outputStream = {
                write: (chunk) => {
                    queueEdit(chunk);
                    return true;
                },
                end: () => { }
            };

            const errorStream = {
                write: (chunk) => {
                    console.log('PromQueen Error/Log:', chunk);
                },
                end: () => { }
            };

            await sendPrompt(prompt, projectRoot, outputStream, errorStream, {});

            // Wait for all edits to finish
            await editQueue;

            // 5. Postcompletion Lint
            // We need fresh text from document
            const finalText = document.getText();
            const postOutput = postCompletionLint(finalText, projectRoot);

            if (postOutput) {
                const edit = new vscode.WorkspaceEdit();
                const lastLine = document.lineAt(document.lineCount - 1);
                const position = lastLine.range.end;
                edit.insert(document.uri, position, postOutput);
                await vscode.workspace.applyEdit(edit);
            }

            vscode.window.showInformationMessage('PromQueen: Pipeline finished.');

        } catch (err) {
            vscode.window.showErrorMessage(`PromQueen Error: ${err.message}`);
            console.error(err);
        }
    });
    context.subscriptions.push(disposable);

    let docDisposable = vscode.commands.registerCommand('promqueen.regenerateLastMessage', async function () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('PromQueen: No active text editor.');
            return;
        }

        const document = editor.document;
        const text = document.getText();

        // Find the last message delimiter
        // The delimiter is \n\n@
        const delimiter = '\n\n@';

        let lastIndex = text.lastIndexOf(delimiter);
        let startIndex;

        if (lastIndex !== -1) {
            // Check if the last "message" is just an empty role (e.g. from postcompletionlint)
            // extraction: \n\n@role\n...
            const remainingText = text.substring(lastIndex + delimiter.length); // text after \n\n@

            // It should look like "roleName\n" or "roleName" with optional whitespace
            // Let's see if there is any content.
            // We can split by newline. The first line is the role name.
            const firstNewLine = remainingText.indexOf('\n');
            let hasContent = false;

            if (firstNewLine === -1) {
                // No newline, so it's just "@roleName" (maybe space). 
                // Effectively empty content.
                hasContent = false;
            } else {
                const contentAfterRole = remainingText.substring(firstNewLine + 1);
                if (contentAfterRole.trim().length > 0) {
                    hasContent = true;
                }
            }

            if (!hasContent) {
                // The last message is empty (just a role). 
                // We want to remove this AND the previous message.
                // So we need to find the delimiter BEFORE this one.
                const prevIndex = text.lastIndexOf(delimiter, lastIndex - 1);
                if (prevIndex !== -1) {
                    startIndex = prevIndex;
                } else {
                    // No previous delimiter, check YAML
                    const yamlEnd = text.indexOf('\n---\n');
                    if (yamlEnd !== -1) {
                        startIndex = yamlEnd + 5;
                    } else {
                        startIndex = 0;
                    }
                }
            } else {
                // Last message has content, so just delete it.
                startIndex = lastIndex;
            }
        } else {
            // No delimiter found, check if it's the first message (after YAML)
            // YAML ends with `\n---\n` or starts the file.
            // We can just look for the end of the YAML frontmatter.
            const yamlEnd = text.indexOf('\n---\n');
            if (yamlEnd !== -1) {
                // Start deleting after the YAML block
                startIndex = yamlEnd + 5; // +5 for \n---\n
            } else {
                // No YAML block? Just delete everything? 
                // Or maybe we shouldn't touch it.
                // Let's assume standard format and maybe just delete from beginning if no YAML?
                // Safer to do nothing if format isn't recognized or maybe just user prompt starts at 0.
                // If there's no previous message, maybe we just clear the document except for YAML?
                startIndex = text.length; // Do nothing effectively
            }
        }

        if (startIndex < text.length) {
            const startPos = document.positionAt(startIndex);
            const endPos = document.positionAt(text.length);
            const range = new vscode.Range(startPos, endPos);

            const edit = new vscode.WorkspaceEdit();
            edit.delete(document.uri, range);
            await vscode.workspace.applyEdit(edit);
        }

        // Trigger the pipeline
        await vscode.commands.executeCommand('promqueen.runPipeline');
    });

    context.subscriptions.push(docDisposable);
}

function deactivate() { }

module.exports = {
    activate,
    deactivate
};
