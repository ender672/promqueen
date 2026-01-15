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
}

function deactivate() { }

module.exports = {
    activate,
    deactivate
};
