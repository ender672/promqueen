const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { precompletionLint } = require('../precompletionlint.js');
const { applyTemplate } = require('../applytemplate.js');
const { applyLorebook, resolveLorebookPath } = require('../apply-lorebook.js');
const { rpToPrompt } = require('../rptoprompt.js');
const { sendPrompt } = require('../sendprompt.js');
const { postCompletionLint } = require('../postcompletionlint.js');
const { ImageHoverProvider } = require('./providers/ImageHoverProvider');
const { CompletionProvider } = require('./providers/CompletionProvider');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    let disposable = vscode.commands.registerCommand('promqueen.runPipeline', async function (options = {}) {
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

            let isFirstEdit = true;
            const applyEdit = async (text) => {
                const activeEditor = vscode.window.activeTextEditor;
                // Use editor.edit if possible for undo control
                if (activeEditor && activeEditor.document === document) {
                    await activeEditor.edit(editBuilder => {
                        const lastLine = document.lineAt(document.lineCount - 1);
                        const position = lastLine.range.end;
                        editBuilder.insert(position, text);
                    }, {
                        undoStopBefore: isFirstEdit && !options.disableUndoStopBefore,
                        undoStopAfter: false
                    });
                } else {
                    // Fallback to WorkspaceEdit
                    const edit = new vscode.WorkspaceEdit();
                    const lastLine = document.lineAt(document.lineCount - 1);
                    const position = lastLine.range.end;
                    edit.insert(document.uri, position, text);
                    await vscode.workspace.applyEdit(edit);
                }
                isFirstEdit = false;
            };

            // 1. Precompletion Lint
            let text = document.getText();
            const preOutput = precompletionLint(text, projectRoot);

            if (preOutput) {
                await applyEdit(preOutput);
                // Update local text after edit
                text = document.getText();
            }

            // 2. Apply Template
            const templated = await applyTemplate(text, {
                messageTemplateLoaderPath: templateLoaderPath,
                data: {},
                cwd: projectRoot
            }, null);

            // 3. Apply Lorebook
            const lorebookPath = resolveLorebookPath(templated, templateLoaderPath);
            let withLorebook = templated;
            if (lorebookPath) {
                const lorebook = JSON.parse(fs.readFileSync(lorebookPath, 'utf8'));
                withLorebook = applyLorebook(templated, lorebook);
            }

            // 4. Rp To Prompt
            const prompt = await rpToPrompt(withLorebook, projectRoot);

            // 5. Send Prompt (Streaming)

            // Helper to sequentially queue edits
            let editQueue = Promise.resolve();
            const queueEdit = (chunk) => {
                editQueue = editQueue.then(async () => {
                    await applyEdit(chunk);
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

            // 6. Postcompletion Lint
            // We need fresh text from document
            const finalText = document.getText();
            const postOutput = postCompletionLint(finalText, projectRoot);

            if (postOutput) {
                await applyEdit(postOutput);
            }

            // Seal the undo group if we did anything
            if (!isFirstEdit) {
                const activeEditor = vscode.window.activeTextEditor;
                // Only verify active editor matches, otherwise we don't care about sealing as fallback was used
                if (activeEditor && activeEditor.document === document) {
                    await activeEditor.edit(editBuilder => {
                        const lastLine = document.lineAt(document.lineCount - 1);
                        const position = lastLine.range.end;
                        editBuilder.insert(position, "");
                    }, {
                        undoStopBefore: false,
                        undoStopAfter: true
                    });
                }
            }

            const autoSave = vscode.workspace.getConfiguration('promqueen').get('autoSaveAfterPipeline', true);
            if (autoSave) {
                await document.save();
            }

            vscode.window.showInformationMessage('PromQueen: Pipeline finished.');

        } catch (err) {
            vscode.window.showErrorMessage(`PromQueen Error: ${err.message}`);
            console.error(err);
        }
    });
    context.subscriptions.push(disposable);

    context.subscriptions.push(
        vscode.languages.registerHoverProvider('promqueen-pqueen', new ImageHoverProvider())
    );

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider('promqueen-pqueen', new CompletionProvider(), '@', '[')
    );

    let previewDisposable = vscode.commands.registerCommand('promqueen.previewPrompt', async function () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('PromQueen: No active text editor.');
            return;
        }

        const document = editor.document;
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        const projectRoot = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(document.uri.fsPath);
        const templateLoaderPath = path.dirname(document.uri.fsPath);

        try {
            // 1. Precompletion Lint
            let text = document.getText();
            const preOutput = precompletionLint(text, projectRoot);

            if (preOutput) {
                text += preOutput;
            }

            // 2. Apply Template
            const templated = await applyTemplate(text, {
                messageTemplateLoaderPath: templateLoaderPath,
                data: {},
                cwd: projectRoot
            }, null);

            // 3. Apply Lorebook
            const lorebookPath = resolveLorebookPath(templated, templateLoaderPath);
            let withLorebook = templated;
            if (lorebookPath) {
                const lorebook = JSON.parse(fs.readFileSync(lorebookPath, 'utf8'));
                withLorebook = applyLorebook(templated, lorebook);
            }

            // 4. Rp To Prompt
            const prompt = await rpToPrompt(withLorebook, projectRoot);

            const doc = await vscode.workspace.openTextDocument({
                content: prompt,
                language: 'promqueen-pqueen'
            });
            await vscode.window.showTextDocument(doc, { preview: false });

        } catch (err) {
            vscode.window.showErrorMessage(`PromQueen Error: ${err.message}`);
            console.error(err);
        }
    });

    context.subscriptions.push(previewDisposable);

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
                // We want to regenerate the PREVIOUS message.
                // So we need to find the delimiter BEFORE this one.
                const prevIndex = text.lastIndexOf(delimiter, lastIndex - 1);
                if (prevIndex !== -1) {
                    // We found the previous delimiter (e.g. \n\n@Assistant)
                    // We want to KEEP "@Assistant\n" and delete the rest.
                    // Find the end of the role line.
                    const roleNewline = text.indexOf('\n', prevIndex + delimiter.length);
                    if (roleNewline !== -1) {
                        startIndex = roleNewline + 1;
                    } else {
                        // Weird case: "@Assistant" at EOF?
                        startIndex = text.length;
                    }
                } else {
                    // No previous delimiter, check YAML
                    const yamlEnd = text.indexOf('\n---\n');
                    if (yamlEnd !== -1) {
                        // User prompt started after YAML?
                        // If we can't find a delimiter, maybe we just delete content after YAML?
                        // But we want to preserve the role if possible. 
                        // If there is no delimiter, there might be no role header "standard" here.
                        // Let's fallback to original behavior: delete everything after YAML.
                        startIndex = yamlEnd + 5;
                    } else {
                        startIndex = 0;
                    }
                }
            } else {
                // Last message has content.
                // We want to KEEP the role line.
                const roleNewline = text.indexOf('\n', lastIndex + delimiter.length);
                if (roleNewline !== -1) {
                    startIndex = roleNewline + 1;
                } else {
                    startIndex = lastIndex; // Fallback
                }
            }
        } else {
            // No delimiter found.
            // Check for YAML
            const yamlEnd = text.indexOf('\n---\n');
            if (yamlEnd !== -1) {
                startIndex = yamlEnd + 5;
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

function deactivate() { }

module.exports = {
    activate,
    deactivate
};
