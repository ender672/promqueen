const vscode = require('vscode');
const path = require('path');
const { rpToHtml } = require('../../lib/rp-to-html.js');
const pqutils = require('../../lib/pq-utils.js');
const sillytavernTemplate = require('../../templates/sillytavern.mustache');

let htmlPreviewPanel = null;
let htmlPreviewDebounceTimer = null;

function updateHtmlPreview(document) {
    if (!htmlPreviewPanel) return;
    if (!document.fileName.endsWith('.pqueen')) return;
    if (document.uri.scheme !== 'file') return;

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const basePath = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(document.uri.fsPath);

    try {
        const text = document.getText().replace(/\r\n/g, '\n');
        const doc = pqutils.parseConfigAndMessages(text);
        const resolvedConfig = pqutils.resolveConfig(doc.config, basePath);
        let html = rpToHtml(doc, resolvedConfig, sillytavernTemplate);
        html += '\n<script>window.scrollTo(0, document.body.scrollHeight);</script>';
        htmlPreviewPanel.webview.html = html;
        htmlPreviewPanel.title = `Preview: ${path.basename(document.fileName)}`;
    } catch (err) {
        console.error('PromQueen HTML preview error:', err);
    }
}

function registerHtmlPreviewCommands(context) {
    let htmlPreviewDisposable = vscode.commands.registerCommand('promqueen.previewHtml', function () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('PromQueen: No active text editor.');
            return;
        }

        if (htmlPreviewPanel) {
            htmlPreviewPanel.reveal(vscode.ViewColumn.Beside);
        } else {
            htmlPreviewPanel = vscode.window.createWebviewPanel(
                'promqueenHtmlPreview',
                'PromQueen: HTML Preview',
                vscode.ViewColumn.Beside,
                { enableScripts: true }
            );
            htmlPreviewPanel.onDidDispose(() => {
                htmlPreviewPanel = null;
            });
        }

        updateHtmlPreview(editor.document);
    });
    context.subscriptions.push(htmlPreviewDisposable);

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            if (!htmlPreviewPanel) return;
            if (!event.document.fileName.endsWith('.pqueen')) return;

            if (htmlPreviewDebounceTimer) return;
            htmlPreviewDebounceTimer = setTimeout(() => {
                htmlPreviewDebounceTimer = null;
                updateHtmlPreview(event.document);
            }, 300);
        })
    );

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (!htmlPreviewPanel) return;
            if (!editor) return;
            if (!editor.document.fileName.endsWith('.pqueen')) return;

            updateHtmlPreview(editor.document);
        })
    );
}

function deactivate() {
    clearTimeout(htmlPreviewDebounceTimer);
}

module.exports = { registerHtmlPreviewCommands, deactivate };
