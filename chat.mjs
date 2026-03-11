#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import React, { useState, useCallback, useEffect, useRef } from 'react';
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

    const handleSubmit = useCallback((text) => {
        setError('');
        setPrefill('');

        if (text.trim() === '/exit') {
            const allMsgs = pendingMsg ? [...messages, pendingMsg] : messages;
            saveFile(allMsgs);
            if (process.stderr.isTTY) process.stderr.write(`\nSaved to ${pqueenPath}\n`);
            exit();
            return;
        }

        if (text.trim() === '/show-prompt') {
            const allMsgs = pendingMsg ? [...messages, pendingMsg] : messages;
            const turn = prepareTurn(allMsgs, resolvedConfig, cwd);
            const preview = pqutils.serializeDocument(resolvedConfig, turn.apiMessages);
            const tmpFile = path.join(os.tmpdir(), `pq-preview-prompt-${Date.now()}.pqueen`);
            fs.writeFileSync(tmpFile, preview);
            const opener = process.platform === 'darwin' ? 'open'
                : process.platform === 'win32' ? 'start' : 'xdg-open';
            execFile(opener, [tmpFile], (err) => {
                if (err) setError(`Could not open file: ${err.message}`);
            });
            return;
        }

        if (text.trim() === '/html') {
            const allMsgs = pendingMsg ? [...messages, pendingMsg] : messages;
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
            // Hollow out the last message, keeping its name/role
            const hollow = { ...lastMsg, content: null, decorators: [] };
            const priorMessages = [...messages.slice(0, -1), hollow];

            const turn = prepareTurn(priorMessages, resolvedConfig, cwd);
            const { apiMessages } = turn;

            process.stdout.write('\x1b[2J\x1b[H');
            setStaticKey(k => k + 1);
            setMessages(messages.slice(0, -1));
            setPendingMsg(null);
            setSentMsg(null);
            setStreamName(lastMsg.name || '');
            setBusy(true);
            setStreamBuf('');
            saveFile(priorMessages);

            (async () => {
                const ac = new AbortController();
                abortRef.current = ac;
                const tw = makeThrottledWriter();
                try {
                    const pricingResult = await dispatchSendPrompt(apiMessages, resolvedConfig, tw, cwd, { signal: ac.signal });
                    tw.flush();

                    let content = tw.chunks.join('');
                    if (content && !content.endsWith('\n')) content += '\n';

                    const regenerated = { ...lastMsg, content, decorators: [] };
                    const completedMessages = [...messages.slice(0, -1), regenerated];
                    setMessages(completedMessages);

                    const afterTurn = [...completedMessages];
                    postCompletionLint(afterTurn, resolvedConfig);

                    const newLast = afterTurn[afterTurn.length - 1];
                    if (newLast.content === null) {
                        setPendingMsg(newLast);
                    }

                    saveFile(afterTurn);

                    if (pricingResult) {
                        setCumulativeTokens(prev => {
                            const next = {
                                prompt: prev.prompt + pricingResult.promptTokens,
                                cached: prev.cached + pricingResult.cachedTokens,
                                completion: prev.completion + pricingResult.completionTokens,
                            };
                            setCostInfo(tokensToString(next.prompt, next.cached, next.completion));
                            return next;
                        });
                    }
                } catch (err) {
                    // Restore original messages and pending state
                    setMessages(messages);
                    setPendingMsg(pendingMsg);
                    saveFile(pendingMsg ? [...messages, pendingMsg] : messages);
                    if (err.name === 'AbortError') {
                        setError('Request cancelled');
                    } else {
                        setError(`Error: ${err.message}`);
                    }
                }
                setStreamBuf('');
                setStreamName('');
                setBusy(false);
            })();
            return;
        }

        if (!pendingMsg) return;

        // Fill the pending message but don't commit to messages yet (Static can't undo)
        const filled = { ...pendingMsg, content: (pendingMsg.content || '') + text + '\n' };
        const allMessages = [...messages, filled];
        setSentMsg(filled);
        setPendingMsg(null);
        saveFile(allMessages);

        const turn = prepareTurn(allMessages, resolvedConfig, cwd);
        const { apiMessages, assistantName, assistantRole } = turn;

        setStreamName(assistantName);
        setBusy(true);
        setStreamBuf('');

        (async () => {
            const ac = new AbortController();
            abortRef.current = ac;
            const tw = makeThrottledWriter();
            try {
                const pricingResult = await dispatchSendPrompt(apiMessages, resolvedConfig, tw, cwd, { signal: ac.signal });
                tw.flush();

                let content = tw.chunks.join('');
                if (content && !content.endsWith('\n')) content += '\n';

                const assistantMsg = {
                    name: assistantName,
                    role: assistantRole,
                    content,
                    decorators: [],
                };

                const afterTurn = [...allMessages, assistantMsg];
                setMessages(prev => [...prev, filled, assistantMsg]);

                // Run post-completion lint to determine next speaker
                postCompletionLint(afterTurn, resolvedConfig);

                // If postCompletionLint pushed a next speaker, use it as pending
                const lastMsg = afterTurn[afterTurn.length - 1];
                if (lastMsg.content === null) {
                    setPendingMsg(lastMsg);
                }

                saveFile(afterTurn);

                if (pricingResult) {
                    setCumulativeTokens(prev => {
                        const next = {
                            prompt: prev.prompt + pricingResult.promptTokens,
                            cached: prev.cached + pricingResult.cachedTokens,
                            completion: prev.completion + pricingResult.completionTokens,
                        };
                        setCostInfo(tokensToString(next.prompt, next.cached, next.completion));
                        return next;
                    });
                }
            } catch (err) {
                // Restore pre-submit state and prefill the input for retry
                setPendingMsg(pendingMsg);
                saveFile(pendingMsg ? [...messages, pendingMsg] : messages);
                setPrefill(text);
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
    }, [messages, pendingMsg, resolvedConfig, cwd, saveFile]);

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
    }));
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && __filename === path.resolve(process.argv[1])) {
    main();
}
