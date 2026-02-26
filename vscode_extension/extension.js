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

function getDocumentText(document) {
    return document.getText().replace(/\r\n/g, '\n');
}

async function preparePrompt(text, templateLoaderPath, projectRoot) {
    const templated = await applyTemplate(text, {
        messageTemplateLoaderPath: templateLoaderPath,
        data: {},
        cwd: projectRoot
    }, null);

    const lorebookPath = resolveLorebookPath(templated, templateLoaderPath);
    let withLorebook = templated;
    if (lorebookPath) {
        const lorebook = JSON.parse(fs.readFileSync(lorebookPath, 'utf8'));
        withLorebook = applyLorebook(templated, lorebook);
    }

    return rpToPrompt(withLorebook, projectRoot);
}

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
            let text = getDocumentText(document);
            const preOutput = precompletionLint(text, projectRoot);

            if (preOutput) {
                await applyEdit(preOutput);
                text = getDocumentText(document);
            }

            // 2. Apply Template → Lorebook → Rp To Prompt
            const prompt = await preparePrompt(text, templateLoaderPath, projectRoot);

            // 3. Send Prompt (Streaming)

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

            // 4. Postcompletion Lint
            // We need fresh text from document
            const finalText = getDocumentText(document);
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
            let text = getDocumentText(document);
            const preOutput = precompletionLint(text, projectRoot);

            if (preOutput) {
                text += preOutput;
            }

            // 2. Apply Template → Lorebook → Rp To Prompt
            const prompt = await preparePrompt(text, templateLoaderPath, projectRoot);

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

    let previewTemplateDisposable = vscode.commands.registerCommand('promqueen.previewTemplate', async function () {
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
            const text = getDocumentText(document);
            const result = await applyTemplate(text, {
                messageTemplateLoaderPath: templateLoaderPath,
                data: {},
                cwd: projectRoot
            }, null);

            const doc = await vscode.workspace.openTextDocument({
                content: result,
                language: 'promqueen-pqueen'
            });
            await vscode.window.showTextDocument(doc, { preview: false });

        } catch (err) {
            vscode.window.showErrorMessage(`PromQueen Error: ${err.message}`);
            console.error(err);
        }
    });
    context.subscriptions.push(previewTemplateDisposable);

    let previewLorebookDisposable = vscode.commands.registerCommand('promqueen.previewLorebook', async function () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('PromQueen: No active text editor.');
            return;
        }

        const document = editor.document;
        const templateLoaderPath = path.dirname(document.uri.fsPath);

        try {
            const text = getDocumentText(document);
            const lorebookPath = resolveLorebookPath(text, templateLoaderPath);
            let result = text;
            if (lorebookPath) {
                const lorebook = JSON.parse(fs.readFileSync(lorebookPath, 'utf8'));
                result = applyLorebook(text, lorebook);
            }

            const doc = await vscode.workspace.openTextDocument({
                content: result,
                language: 'promqueen-pqueen'
            });
            await vscode.window.showTextDocument(doc, { preview: false });

        } catch (err) {
            vscode.window.showErrorMessage(`PromQueen Error: ${err.message}`);
            console.error(err);
        }
    });
    context.subscriptions.push(previewLorebookDisposable);

    let preLintDisposable = vscode.commands.registerCommand('promqueen.runPrecompletionLint', async function () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('PromQueen: No active text editor.');
            return;
        }

        const document = editor.document;
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        const projectRoot = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(document.uri.fsPath);

        try {
            const text = getDocumentText(document);
            const preOutput = precompletionLint(text, projectRoot);

            if (preOutput) {
                await editor.edit(editBuilder => {
                    const lastLine = document.lineAt(document.lineCount - 1);
                    const position = lastLine.range.end;
                    editBuilder.insert(position, preOutput);
                });
            }

            const autoSave = vscode.workspace.getConfiguration('promqueen').get('autoSaveAfterPipeline', true);
            if (autoSave) {
                await document.save();
            }
        } catch (err) {
            vscode.window.showErrorMessage(`PromQueen Error: ${err.message}`);
            console.error(err);
        }
    });
    context.subscriptions.push(preLintDisposable);

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

function deactivate() { }

module.exports = {
    activate,
    deactivate
};
