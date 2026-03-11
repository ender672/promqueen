const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { applyTemplate } = require('../../apply-template.js');
const { applyLorebook, resolveLorebookPath } = require('../../apply-lorebook.js');
const pqutils = require('../../lib/pq-utils.js');
const { prepareTurn } = require('../../lib/pipeline.js');
const { getDocumentText } = require('./helpers');

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
            const text = getDocumentText(document);
            const parsedDoc = pqutils.parseConfigAndMessages(text);
            const resolvedConfig = pqutils.resolveConfig(parsedDoc.config, projectRoot, {});
            const { apiMessages } = prepareTurn(parsedDoc.messages, resolvedConfig, templateLoaderPath);

            // Serialize for display using role-based format
            const displayOutput = pqutils.serializeDocument(parsedDoc.config, apiMessages);

            const doc = await vscode.workspace.openTextDocument({
                content: displayOutput,
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
            const parsedDoc = pqutils.parseConfigAndMessages(text);
            const resolvedConfig = pqutils.resolveConfig(parsedDoc.config, projectRoot, {});
            const resultMessages = applyTemplate(parsedDoc.messages, resolvedConfig, {
                messageTemplateLoaderPath: templateLoaderPath,
                cwd: projectRoot
            });

            const result = pqutils.serializeDocument(parsedDoc.config, resultMessages);

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
            const parsedDoc = pqutils.parseConfigAndMessages(text);
            const resolvedConfig = pqutils.resolveConfig(parsedDoc.config);

            let lorebookPath = resolveLorebookPath(resolvedConfig, templateLoaderPath);
            if (!lorebookPath) {
                const defaultPath = path.resolve(templateLoaderPath, 'character_book.json');
                if (fs.existsSync(defaultPath)) lorebookPath = defaultPath;
            }
            let resultMessages = parsedDoc.messages;
            if (lorebookPath) {
                const lorebook = JSON.parse(fs.readFileSync(lorebookPath, 'utf8'));
                resultMessages = applyLorebook(parsedDoc.messages, resolvedConfig, lorebook);
            }

            const result = pqutils.serializeDocument(parsedDoc.config, resultMessages);

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
