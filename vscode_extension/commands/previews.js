const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { applyTemplate } = require('../../applytemplate.js');
const { applyLorebook, resolveLorebookPath } = require('../../apply-lorebook.js');
const { precompletionLint } = require('../../precompletionlint.js');
const { getDocumentText, preparePrompt } = require('./helpers');

function registerPreviewCommands(context) {
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

            // 2. Apply Template -> Lorebook -> Rp To Prompt
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
            let lorebookPath = resolveLorebookPath(text, templateLoaderPath);
            if (!lorebookPath) {
                const defaultPath = path.resolve(templateLoaderPath, 'character_book.json');
                if (fs.existsSync(defaultPath)) lorebookPath = defaultPath;
            }
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
}

module.exports = { registerPreviewCommands };
