const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, execFileSync } = require('child_process');
const { prepareTurn } = require('./pipeline.js');
const pqutils = require('./pq-utils.js');
const { rpToHtml } = require('../rp-to-html.js');

const midnightTemplate = fs.readFileSync(
    path.join(__dirname, '..', 'templates', 'midnight.mustache'),
    'utf8'
);

function findOpener() {
    if (process.platform === 'darwin') return 'open';
    if (process.platform === 'win32') return 'start';
    for (const cmd of ['firefox', 'google-chrome', 'chromium', 'chromium-browser', 'xdg-open']) {
        try { execFileSync('which', [cmd], { stdio: 'ignore' }); return cmd; } catch { /* not found */ }
    }
    return null;
}

function openInViewer(filePath, setError, label) {
    const opener = findOpener();
    if (!opener) {
        setError(label || 'No file opener found');
        return;
    }
    execFile(opener, [filePath], (err) => {
        if (err) setError(`Could not open: ${err.message}`);
    });
}

function cmdExit(ctx) {
    ctx.saveFile(ctx.allMsgs);
    ctx.exit();
}

function cmdShowPrompt(ctx) {
    const turn = prepareTurn(ctx.allMsgs, ctx.resolvedConfig, ctx.cwd, ctx.pqueenPath);
    const preview = pqutils.serializeDocument(ctx.resolvedConfig, turn.apiMessages);
    const tmpFile = path.join(os.tmpdir(), `pq-preview-prompt-${Date.now()}.pqueen`);
    fs.writeFileSync(tmpFile, preview);
    openInViewer(tmpFile, ctx.setError, 'No file opener found');
}

function cmdHtml(ctx) {
    const doc = { messages: ctx.allMsgs };
    const html = rpToHtml(doc, ctx.resolvedConfig, midnightTemplate);
    const tmpFile = path.join(os.tmpdir(), `pq-preview-${Date.now()}.html`);
    fs.writeFileSync(tmpFile, html);
    openInViewer(tmpFile, ctx.setError, 'No browser found');
}

function cmdShowCard(ctx) {
    if (!ctx.resolvedConfig.charcard) {
        ctx.setError('No charcard configured');
        return;
    }
    const cardPath = path.resolve(ctx.cwd, ctx.resolvedConfig.charcard);
    if (!fs.existsSync(cardPath)) {
        ctx.setError(`Card not found: ${cardPath}`);
        return;
    }
    openInViewer(cardPath, ctx.setError, 'No file opener found');
}

function cmdRegenerate(ctx) {
    if (ctx.messages.length === 0) return;
    const lastMsg = ctx.messages[ctx.messages.length - 1];

    // Seed the generations list with the current content if starting fresh
    if (ctx.generations.length === 0 && lastMsg.content) {
        ctx.setGenerations([lastMsg.content]);
    }

    const hollow = { ...lastMsg, content: null, decorators: [] };
    const priorMessages = [...ctx.messages.slice(0, -1), hollow];

    const turn = prepareTurn(priorMessages, ctx.resolvedConfig, ctx.cwd, ctx.pqueenPath);
    const { apiMessages, nextEntry } = turn;

    const rollbackMessages = ctx.messages;
    const rollbackPending = ctx.pendingMsg;

    ctx.setMessages(ctx.messages.slice(0, -1));
    ctx.setPendingMsg(null);
    ctx.refreshScreen();
    ctx.saveFile(priorMessages);

    ctx.runGeneration({
        apiMessages,
        streamName: nextEntry.name || '',
        onSuccess(content) {
            const completed = { ...nextEntry, content };
            const completedMessages = [...ctx.messages.slice(0, -1), completed];
            ctx.setMessages(completedMessages);
            ctx.setGenerations(prev => {
                const next = [...prev, content];
                ctx.setGenerationIdx(next.length - 1);
                return next;
            });
            return [...completedMessages];
        },
        onError() {
            ctx.setMessages(rollbackMessages);
            ctx.setPendingMsg(rollbackPending);
            ctx.saveFile(rollbackPending ? [...rollbackMessages, rollbackPending] : rollbackMessages);
        },
    });
}

function cmdDeleteLast(ctx) {
    if (ctx.messages.length === 0) return;
    ctx.setGenerations([]);
    ctx.setGenerationIdx(-1);
    const remaining = ctx.messages.slice(0, -1);
    const lastRemaining = remaining[remaining.length - 1];
    if (lastRemaining) {
        ctx.setMessages(remaining.slice(0, -1));
        ctx.setPendingMsg({ ...lastRemaining, content: null, decorators: [] });
        ctx.setPrefill(lastRemaining.content || '');
        ctx.saveFile(remaining);
    } else {
        ctx.setMessages([]);
        ctx.setPendingMsg(null);
        ctx.saveFile([]);
    }
    ctx.refreshScreen();
}

function cmdGenerate(ctx) {
    if (!ctx.pendingMsg) return;
    const turn = prepareTurn(ctx.allMsgs, ctx.resolvedConfig, ctx.cwd, ctx.pqueenPath);
    const { apiMessages, nextEntry } = turn;

    ctx.setStreamToEditbox(true);
    ctx.runGeneration({
        apiMessages,
        streamName: nextEntry.name || '',
        onSuccess(content) {
            ctx.setPrefill(content);
            return ctx.allMsgs;
        },
        onError() {},
    });
}

function cmdEditSpeaker(ctx) {
    if (!ctx.pendingMsg) return;
    ctx.setEditingSpeaker(true);
    ctx.setPrefill(ctx.pendingMsg.name || '');
    ctx.refreshScreen();
}

function cmdFinishEditSpeaker(ctx, text) {
    const name = text.trim();
    ctx.setEditingSpeaker(false);
    if (!name || !ctx.pendingMsg) return;

    const role = pqutils.PROMPT_ROLES.includes(name) ? name
        : name === ctx.resolvedConfig.roleplay_user ? 'user'
        : 'assistant';

    const updated = { ...ctx.pendingMsg, name, role };
    ctx.setPendingMsg(updated);
    const allUpdated = [...ctx.messages, updated];
    ctx.saveFile(allUpdated);
    ctx.refreshScreen();
}

function cmdBranch(ctx) {
    const ext = path.extname(ctx.pqueenPath);
    const base = ctx.pqueenPath.slice(0, -ext.length);
    let n = 1;
    let newPath;
    while (true) {
        newPath = `${base}-${n}${ext}`;
        if (!fs.existsSync(newPath)) break;
        n++;
    }
    ctx.saveToPath(newPath, ctx.allMsgs);
    ctx.setPqueenPath(newPath);
    ctx.refreshScreen();
}

function cmdEditLast(ctx) {
    if (ctx.messages.length === 0) return;
    ctx.setGenerations([]);
    ctx.setGenerationIdx(-1);
    const lastMsg = ctx.messages[ctx.messages.length - 1];
    ctx.setMessages(ctx.messages.slice(0, -1));
    ctx.setPendingMsg({ ...lastMsg, content: null, decorators: [] });
    ctx.setPrefill(lastMsg.content || '');
    ctx.refreshScreen();
}

function cmdSubmitText(ctx, text) {
    if (!ctx.pendingMsg) return;
    ctx.setGenerations([]);
    ctx.setGenerationIdx(-1);

    const filled = { ...ctx.pendingMsg, content: (ctx.pendingMsg.content || '') + text };
    const allMessages = [...ctx.messages, filled];
    const rollbackMessages = ctx.messages;
    const rollbackPending = ctx.pendingMsg;

    ctx.setMessages(allMessages);
    ctx.setPendingMsg(null);
    ctx.refreshScreen();
    ctx.saveFile(allMessages);

    const turn = prepareTurn(allMessages, ctx.resolvedConfig, ctx.cwd);
    const { apiMessages, nextEntry } = turn;

    if (nextEntry.role === 'user') {
        ctx.setPendingMsg(nextEntry);
        ctx.saveFile([...allMessages, nextEntry]);
        return;
    }

    ctx.runGeneration({
        apiMessages,
        streamName: nextEntry.name,
        onSuccess(content) {
            const completed = { ...nextEntry, content };
            ctx.setMessages(prev => [...prev, completed]);
            return [...allMessages, completed];
        },
        onError() {
            ctx.setMessages(rollbackMessages);
            ctx.setPendingMsg(rollbackPending);
            ctx.saveFile(rollbackPending ? [...rollbackMessages, rollbackPending] : rollbackMessages);
            ctx.setPrefill(text);
        },
    });
}

const SLASH_COMMANDS = {
    '/exit': cmdExit,
    '/show-prompt': cmdShowPrompt,
    '/html': cmdHtml,
    '/show-card': cmdShowCard,
    '/regenerate': cmdRegenerate,
    '/delete-last': cmdDeleteLast,
    '/generate': cmdGenerate,
    '/edit-last': cmdEditLast,
    '/edit-speaker': cmdEditSpeaker,
    '/branch': cmdBranch,
};

module.exports = { SLASH_COMMANDS, cmdSubmitText, cmdFinishEditSpeaker, findOpener };
