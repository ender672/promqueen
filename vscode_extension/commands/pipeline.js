const vscode = require('vscode');
const path = require('path');
const { precompletionLint } = require('../../precompletionlint.js');
const { sendPrompt } = require('../../sendprompt.js');
const { sendRawPrompt } = require('../../sendrawprompt.js');
const { postCompletionLint } = require('../../postcompletionlint.js');
const pqutils = require('../../lib/pqutils.js');
const { getDocumentText, preparePrompt } = require('./helpers');

const activePipelines = new Map();

async function executePipeline(document, progress, abortController, options) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const projectRoot = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(document.uri.fsPath);
    const templateLoaderPath = path.dirname(document.uri.fsPath);

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

    // 1. Parse and precompletion lint
    progress.report({ message: 'Running precompletion lint...' });
    let text = getDocumentText(document);
    let doc = pqutils.parseConfigAndMessages(text);
    const preOutput = precompletionLint(doc, projectRoot);

    if (preOutput) {
        await applyEdit(preOutput);
        text = getDocumentText(document);
        doc = pqutils.parseConfigAndMessages(text);
    }

    // 2. Resolve config and prepare prompt
    progress.report({ message: 'Preparing prompt...' });
    const resolvedConfig = pqutils.resolveConfig(doc.config, projectRoot, {});
    const apiMessages = preparePrompt(doc.messages, resolvedConfig, templateLoaderPath, projectRoot);

    // 3. Send Prompt (Streaming)
    progress.report({ message: 'Streaming response...' });

    let editQueue = Promise.resolve();
    let editError = null;
    const queueEdit = (chunk) => {
        editQueue = editQueue.then(async () => {
            if (editError) return;
            await applyEdit(chunk);
        }).catch(err => {
            editError = err;
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

    const sendOptions = { signal: abortController.signal };
    if (resolvedConfig.api_url && resolvedConfig.api_url.endsWith('/v1/completions')) {
        await sendRawPrompt(apiMessages, resolvedConfig, outputStream, errorStream, templateLoaderPath, sendOptions);
    } else {
        await sendPrompt(apiMessages, resolvedConfig, outputStream, errorStream, sendOptions);
    }

    // Wait for all edits to finish
    await editQueue;
    if (editError) throw editError;

    // 4. Postcompletion Lint
    progress.report({ message: 'Running postcompletion lint...' });
    const finalText = getDocumentText(document);
    const finalDoc = pqutils.parseConfigAndMessages(finalText);
    const postOutput = postCompletionLint(finalDoc, projectRoot);

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
}

function registerPipelineCommands(context) {
    let disposable = vscode.commands.registerCommand('promqueen.runPipeline', async function (options = {}) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('PromQueen: No active text editor.');
            return;
        }

        const document = editor.document;
        const documentKey = document.uri.toString();

        if (activePipelines.has(documentKey)) {
            vscode.window.showWarningMessage('PromQueen: A pipeline is already running for this file.');
            return;
        }

        const abortController = new AbortController();
        activePipelines.set(documentKey, abortController);

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'PromQueen',
                cancellable: true
            }, async (progress, token) => {
                token.onCancellationRequested(() => abortController.abort());
                await executePipeline(document, progress, abortController, options);
            });

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
            const doc = pqutils.parseConfigAndMessages(text);
            const preOutput = precompletionLint(doc, projectRoot);

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
