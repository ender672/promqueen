const vscode = require('vscode');
const path = require('path');
const { precompletionLint } = require('../../precompletionlint.js');
const { sendPrompt } = require('../../sendprompt.js');
const { sendRawPrompt } = require('../../sendrawprompt.js');
const { postCompletionLint } = require('../../postcompletionlint.js');
const pqutils = require('../../lib/pqutils.js');
const { getDocumentText, preparePrompt } = require('./helpers');

const activePipelines = new Map();

function registerPipelineCommands(context) {
    let disposable = vscode.commands.registerCommand('promqueen.runPipeline', async function (options = {}) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('PromQueen: No active text editor.');
            return;
        }

        const document = editor.document;
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        const projectRoot = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(document.uri.fsPath);
        const templateLoaderPath = path.dirname(document.uri.fsPath);

        const abortController = new AbortController();
        const documentKey = document.uri.toString();
        activePipelines.set(documentKey, abortController);

        try {
            vscode.window.showInformationMessage('PromQueen: Starting pipeline...');

            let isFirstEdit = true;
            const applyEdit = async (text) => {
                const activeEditor = vscode.window.activeTextEditor;
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

            // 2. Apply Template -> Lorebook -> Rp To Prompt
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

            const { config: sendConfig } = pqutils.parseConfigOnly(prompt);
            const resolvedSendConfig = pqutils.resolveConfig(sendConfig, projectRoot, {});

            const sendOptions = { signal: abortController.signal };
            if (resolvedSendConfig.api_url && resolvedSendConfig.api_url.endsWith('/v1/completions')) {
                await sendRawPrompt(prompt, projectRoot, outputStream, errorStream, {}, templateLoaderPath, sendOptions);
            } else {
                await sendPrompt(prompt, projectRoot, outputStream, errorStream, {}, sendOptions);
            }

            // Wait for all edits to finish
            await editQueue;

            // 4. Postcompletion Lint
            const finalText = getDocumentText(document);
            const postOutput = postCompletionLint(finalText, projectRoot);

            if (postOutput) {
                await applyEdit(postOutput);
            }

            // Seal the undo group if we did anything
            if (!isFirstEdit) {
                const activeEditor = vscode.window.activeTextEditor;
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
            if (err.name === 'AbortError') {
                vscode.window.showInformationMessage('PromQueen: Pipeline cancelled.');
            } else {
                vscode.window.showErrorMessage(`PromQueen Error: ${err.message}`);
                console.error(err);
            }
        } finally {
            activePipelines.delete(documentKey);
        }
    });
    context.subscriptions.push(disposable);

    let cancelDisposable = vscode.commands.registerCommand('promqueen.cancelPipeline', function () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('PromQueen: No active text editor.');
            return;
        }
        const key = editor.document.uri.toString();
        const controller = activePipelines.get(key);
        if (controller) {
            controller.abort();
            vscode.window.showInformationMessage('PromQueen: Cancelling pipeline...');
        } else {
            vscode.window.showInformationMessage('PromQueen: No active pipeline for this file.');
        }
    });
    context.subscriptions.push(cancelDisposable);

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
}

module.exports = { registerPipelineCommands };
