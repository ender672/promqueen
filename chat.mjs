#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { render, useInput, useApp } from 'ink';
import { ChatView, splitMessages } from './chat-ink-view.mjs';

const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const { postCompletionLint } = require('./post-completion-lint.js');
const { prepareTurn, dispatchSendPrompt } = require('./lib/pipeline.js');
const { tokensToString } = require('./lib/send-prompt-common.js');
const pqutils = require('./lib/pq-utils.js');
const { rpToHtml } = require('./rp-to-html.js');
const os = require('os');
const { execFile, execFileSync } = require('child_process');

const h = React.createElement;

const midnightTemplate = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates', 'midnight.mustache'),
    'utf8'
);

function findOpener() {
    if (process.platform === 'darwin') return 'open';
    if (process.platform === 'win32') return 'start';
    for (const cmd of ['firefox', 'google-chrome', 'chromium', 'chromium-browser', 'xdg-open']) {
        try { execFileSync('which', [cmd], { stdio: 'ignore' }); return cmd; } catch {}
    }
    return null;
}

// ─── App ────────────────────────────────────────────────────────────────────

function App({ pqueenPath, cwd, connectionName, initialMessages, resolvedConfig, rawConfig }) {
    const { exit } = useApp();
    const initial = splitMessages(initialMessages);
    const [messages, setMessages] = useState(initial.completed);
    const [pendingMsg, setPendingMsg] = useState(initial.pending);
    const [busy, setBusy] = useState(false);
    const [costInfo, setCostInfo] = useState('');
    const [cumulativeTokens, setCumulativeTokens] = useState({ prompt: 0, cached: 0, completion: 0 });
    const [streamBuf, setStreamBuf] = useState('');
    const [streamName, setStreamName] = useState('');
    const [error, setError] = useState('');
    const [prefill, setPrefill] = useState('');
    const [sentMsg, setSentMsg] = useState(null);
    const [staticKey, setStaticKey] = useState(0);
    const abortRef = useRef(null);

    // Returns { writer, flush } — writer batches chunks, flushing to
    // setStreamBuf at most once per animation frame to avoid jumpy redraws.
    const makeThrottledWriter = useCallback(() => {
        const chunks = [];
        let pending = '';
        let rafId = null;
        const flush = () => {
            if (pending) {
                const p = pending;
                pending = '';
                setStreamBuf(buf => buf + p);
            }
            if (rafId) { clearTimeout(rafId); rafId = null; }
        };
        const writer = {
            chunks,
            write(chunk) {
                chunks.push(chunk);
                pending += chunk;
                if (!rafId) {
                    rafId = setTimeout(flush, 60);
                }
            },
            flush,
        };
        return writer;
    }, []);

    // Stream a completion and return the content string. Caller sets up
    // pre-call state and handles the result — this just does the network call.
    const streamCompletion = useCallback(async (apiMessages, ac, tw) => {
        abortRef.current = ac;
        const pricingResult = await dispatchSendPrompt(apiMessages, resolvedConfig, tw, cwd, { signal: ac.signal });
        tw.flush();
        let content = tw.chunks.join('');
        if (content.endsWith('\n')) content = content.slice(0, -1);
        return { content, pricingResult };
    }, [resolvedConfig, cwd]);

    // Accumulate token counts from a pricingResult into cumulative state.
    const accumulateTokens = useCallback((pricingResult) => {
        if (!pricingResult) return;
        setCumulativeTokens(prev => {
            const next = {
                prompt: prev.prompt + pricingResult.promptTokens,
                cached: prev.cached + pricingResult.cachedTokens,
                completion: prev.completion + pricingResult.completionTokens,
            };
            setCostInfo(tokensToString(next.prompt, next.cached, next.completion));
            return next;
        });
    }, []);

    // Collect all messages including pending, for save/preview operations.
    const allMsgs = useMemo(() => {
        return pendingMsg ? [...messages, pendingMsg] : messages;
    }, [messages, pendingMsg]);

    useEffect(() => {
        const onResize = () => {
            process.stdout.write('\x1b[2J\x1b[H');
            setStaticKey(k => k + 1);
        };
        process.stdout.on('resize', onResize);
        return () => process.stdout.off('resize', onResize);
    }, []);

    const saveFile = useCallback((msgs) => {
        fs.writeFileSync(pqueenPath, pqutils.serializeDocument(rawConfig, msgs));
    }, [pqueenPath, rawConfig]);

    // Stream a generation and run the post-completion pipeline.  Callers
    // control what happens on success/error via callbacks:
    //   onSuccess(content) → must return the full afterTurn message array
    //   onError(err)       → rollback state however the caller needs
    const runGeneration = useCallback(({ apiMessages, streamName: name, onSuccess, onError }) => {
        setStreamName(name);
        setBusy(true);
        setStreamBuf('');

        (async () => {
            try {
                const ac = new AbortController();
                const { content, pricingResult } = await streamCompletion(
                    apiMessages, ac, makeThrottledWriter());

                const afterTurn = onSuccess(content);
                postCompletionLint(afterTurn, resolvedConfig);

                const lastMsg = afterTurn[afterTurn.length - 1];
                if (lastMsg.content === null) {
                    setPendingMsg(lastMsg);
                }

                saveFile(afterTurn);
                accumulateTokens(pricingResult);
            } catch (err) {
                if (onError) onError(err);
                if (err.name === 'AbortError') {
                    setError('Request cancelled');
                } else {
                    setError(`Error: ${err.message}`);
                }
            }
            setSentMsg(null);
            setStreamBuf('');
            setStreamName('');
            setBusy(false);
        })();
    }, [resolvedConfig, streamCompletion, accumulateTokens, makeThrottledWriter, saveFile]);

    const handleSubmit = useCallback((text) => {
        if (busy) return;
        setError('');
        setPrefill('');

        if (text.trim() === '/exit') {
            saveFile(allMsgs);
            if (process.stderr.isTTY) process.stderr.write(`\nSaved to ${pqueenPath}\n`);
            exit();
            return;
        }

        if (text.trim() === '/show-prompt') {
            const turn = prepareTurn(allMsgs, resolvedConfig, cwd);
            const preview = pqutils.serializeDocument(resolvedConfig, turn.apiMessages);
            const tmpFile = path.join(os.tmpdir(), `pq-preview-prompt-${Date.now()}.pqueen`);
            fs.writeFileSync(tmpFile, preview);
            const opener = findOpener();
            if (!opener) {
                setError('No file opener found');
                return;
            }
            execFile(opener, [tmpFile], (err) => {
                if (err) setError(`Could not open file: ${err.message}`);
            });
            return;
        }

        if (text.trim() === '/html') {
            const doc = { messages: allMsgs };
            const html = rpToHtml(doc, resolvedConfig, midnightTemplate);
            const tmpFile = path.join(os.tmpdir(), `pq-preview-${Date.now()}.html`);
            fs.writeFileSync(tmpFile, html);
            const opener = findOpener();
            if (!opener) {
                setError('No browser found');
                return;
            }
            execFile(opener, [tmpFile], (err) => {
                if (err) setError(`Could not open browser: ${err.message}`);
            });
            return;
        }

        if (text.trim() === '/regenerate') {
            if (messages.length === 0) return;
            const lastMsg = messages[messages.length - 1];
            const hollow = { ...lastMsg, content: null, decorators: [] };
            const priorMessages = [...messages.slice(0, -1), hollow];

            const turn = prepareTurn(priorMessages, resolvedConfig, cwd);
            const { apiMessages } = turn;

            // Capture rollback state before optimistic updates
            const rollbackMessages = messages;
            const rollbackPending = pendingMsg;

            process.stdout.write('\x1b[2J\x1b[H');
            setStaticKey(k => k + 1);
            setMessages(messages.slice(0, -1));
            setPendingMsg(null);
            setSentMsg(null);
            saveFile(priorMessages);

            runGeneration({
                apiMessages,
                streamName: lastMsg.name || '',
                onSuccess(content) {
                    const regenerated = { ...lastMsg, content, decorators: [] };
                    const completedMessages = [...messages.slice(0, -1), regenerated];
                    setMessages(completedMessages);
                    return [...completedMessages];
                },
                onError() {
                    setMessages(rollbackMessages);
                    setPendingMsg(rollbackPending);
                    saveFile(rollbackPending ? [...rollbackMessages, rollbackPending] : rollbackMessages);
                },
            });
            return;
        }

        if (!pendingMsg) return;

        const filled = { ...pendingMsg, content: (pendingMsg.content || '') + text };
        const allMessages = [...messages, filled];
        // Capture rollback state before optimistic updates
        const rollbackPending = pendingMsg;

        setSentMsg(filled);
        setPendingMsg(null);
        saveFile(allMessages);

        const turn = prepareTurn(allMessages, resolvedConfig, cwd);
        const { apiMessages, assistantName, assistantRole } = turn;

        runGeneration({
            apiMessages,
            streamName: assistantName,
            onSuccess(content) {
                const assistantMsg = {
                    name: assistantName,
                    role: assistantRole,
                    content,
                    decorators: [],
                };
                setMessages(prev => [...prev, filled, assistantMsg]);
                return [...allMessages, assistantMsg];
            },
            onError() {
                setPendingMsg(rollbackPending);
                saveFile(rollbackPending ? [...messages, rollbackPending] : messages);
                setPrefill(text);
            },
        });
    }, [messages, pendingMsg, allMsgs, busy, resolvedConfig, cwd, saveFile,
        runGeneration]);

    useInput((_input, key) => {
        if (key.escape && busy) {
            if (abortRef.current) abortRef.current.abort();
        } else if (key.escape && !busy) {
            const allMsgs = pendingMsg ? [...messages, pendingMsg] : messages;
            saveFile(allMsgs);
            if (process.stderr.isTTY) process.stderr.write(`\nSaved to ${pqueenPath}\n`);
            exit();
        }
    });

    return h(ChatView, {
        messages, streamName, streamBuf, pendingMsg, sentMsg,
        busy, connectionName, costInfo, staticKey,
        onSubmit: handleSubmit,
        errorBanner: error,
        initialText: prefill,
    });
}

export { App };

// ─── Main ───────────────────────────────────────────────────────────────────

const { runSetup } = require('./lib/chat-setup.js');

async function main() {
    const inputPath = process.argv[2];
    if (!inputPath) {
        console.error('Usage: chat.mjs <file.png | file.pqueen>');
        process.exit(1);
    }

    const resolved = path.resolve(inputPath);
    if (!fs.existsSync(resolved)) {
        console.error(`File not found: ${resolved}`);
        process.exit(1);
    }

    let pqueenPath;
    let cliConfig = {};

    if (resolved.endsWith('.png')) {
        const result = await runSetup(resolved);
        pqueenPath = result.pqueenPath;
        cliConfig = result.cliConfig;
    } else if (resolved.endsWith('.pqueen')) {
        pqueenPath = resolved;
    } else {
        console.error('Expected a .png or .pqueen file.');
        process.exit(1);
    }

    const cwd = path.dirname(pqueenPath);
    const content = fs.readFileSync(pqueenPath, 'utf8');
    const doc = pqutils.parseConfigAndMessages(content);
    const resolvedConfig = pqutils.resolveConfig(doc.config, cwd, cliConfig);

    // Clear any remaining setup output before starting the chat UI
    if (process.stderr.isTTY) process.stderr.write('\x1b[2J\x1b[H');

    render(h(App, {
        pqueenPath,
        cwd,
        connectionName: resolvedConfig.connection || '',
        initialMessages: doc.messages,
        resolvedConfig,
        rawConfig: doc.config,
    }), { exitOnCtrlC: false });
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && __filename === path.resolve(process.argv[1])) {
    main();
}
