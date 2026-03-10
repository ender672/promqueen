#!/usr/bin/env node

import { createRequire } from 'module';
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { render, Box, Text, useInput, useApp, useStdout } from 'ink';

const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const { precompletionLint } = require('./pre-completion-lint.js');
const { postCompletionLint } = require('./post-completion-lint.js');
const { preparePrompt, dispatchSendPrompt } = require('./lib/pipeline.js');
const { pricingToString } = require('./lib/send-prompt-common.js');
const pqutils = require('./lib/pq-utils.js');

const h = React.createElement;

// ─── File store (same as chat.js) ───────────────────────────────────────────

function createFileStore(absolutePath) {
    return {
        read() { return fs.readFileSync(absolutePath, 'utf8'); },
        append(text) { fs.appendFileSync(absolutePath, text); },
        size() { return fs.statSync(absolutePath).size; },
        truncate(byteLength) { fs.truncateSync(absolutePath, byteLength); },
    };
}

function displayConversation(store, cwd) {
    const content = store.read();
    const doc = pqutils.parseConfigAndMessages(content);
    const resolvedConfig = pqutils.resolveConfig(doc.config, cwd);
    const { buildTemplateContext, renderTemplate } = require('./lib/render-template.js');
    const context = buildTemplateContext(resolvedConfig, doc.messages, { cwd });

    // Skip the last message if it has no content — the effect will display it
    // so Ink's input-box clearing can't create a gap between @header and user text
    const lastMsg = doc.messages.at(-1);
    const displayCount = (lastMsg && !lastMsg.content)
        ? doc.messages.length - 1
        : doc.messages.length;

    for (let i = 0; i < displayCount; i++) {
        const msg = doc.messages[i];
        if (i > 0) process.stdout.write('\n');
        if (msg.name) process.stdout.write(`\x1b[36m@${msg.name}\x1b[0m\n`);
        if (msg.content) {
            const rendered = renderTemplate(msg.content, context, null, null, { allowIncludes: false });
            process.stdout.write(rendered);
            if (!rendered.endsWith('\n')) process.stdout.write('\n');
        }
    }
}

// ─── Chat turn (adapted from chat.js, no readline dependency) ───────────────

async function runChatTurn(store, cwd, writeFn, cliConfig) {
    const snapshotSize = store.size();

    let content = store.read();
    let doc = pqutils.parseConfigAndMessages(content);
    const resolvedConfig = pqutils.resolveConfig(doc.config, cwd, cliConfig);

    const preOutput = precompletionLint(doc.messages, resolvedConfig);
    if (preOutput) {
        store.append(preOutput);
        writeFn(preOutput.replace(/@(\S+)/g, '\x1b[36m@$1\x1b[0m'));
    }

    const apiMessages = preparePrompt(doc.messages, resolvedConfig, cwd, cwd);

    const chunks = [];
    const teeStream = {
        write(chunk) {
            writeFn(chunk);
            chunks.push(chunk);
        }
    };

    const controller = new AbortController();

    let pricingResult;
    try {
        pricingResult = await dispatchSendPrompt(apiMessages, resolvedConfig, teeStream, cwd, { signal: controller.signal });
    } catch (err) {
        store.truncate(snapshotSize);
        if (err.name === 'AbortError') {
            writeFn('\n[cancelled]\n');
        } else {
            writeFn(`\nError: ${err.message}\n`);
        }
        return { failed: true };
    }

    store.append(chunks.join(''));

    // Ensure trailing newline after streamed response
    const cur = store.read();
    if (!cur.endsWith('\n')) {
        store.append('\n');
        writeFn('\n');
    }

    // Post-completion lint — display padding newlines for visual closure,
    // but defer @speaker header to the start of the next turn
    let displayPos = store.read().length;
    content = store.read();
    doc = pqutils.parseConfigAndMessages(content);
    const postConfig = { ...resolvedConfig, user: resolvedConfig.user || resolvedConfig.roleplay_user };
    const postOutput = postCompletionLint(doc.messages, postConfig);
    if (postOutput) {
        store.append(postOutput);
        const paddingMatch = postOutput.match(/^(\n+)/);
        if (paddingMatch) {
            writeFn(paddingMatch[1]);
            displayPos += paddingMatch[1].length;
        }
    }

    return { failed: false, pricingResult, displayPos };
}

// ─── Multi-line TextArea component ──────────────────────────────────────────

function TextArea({ onSubmit, height, disabled }) {
    const bufRef = useRef({ lines: [''], row: 0, col: 0 });
    const [, forceRender] = useState(0);
    const kick = () => forceRender(n => n + 1);
    const buf = bufRef.current;

    useInput((input, key) => {
        if (disabled || key.escape) return;

        // Ctrl+D: submit
        if (input === 'd' && key.ctrl) {
            const text = buf.lines.join('\n').trim();
            if (text) {
                onSubmit(text);
                buf.lines = [''];
                buf.row = 0;
                buf.col = 0;
                kick();
            }
            return;
        }

        // Enter: newline
        if (key.return) {
            const before = buf.lines[buf.row].slice(0, buf.col);
            const after = buf.lines[buf.row].slice(buf.col);
            buf.lines.splice(buf.row, 1, before, after);
            buf.row++;
            buf.col = 0;
            kick();
            return;
        }

        // Backspace
        if (key.backspace || key.delete) {
            if (buf.col > 0) {
                buf.lines[buf.row] = buf.lines[buf.row].slice(0, buf.col - 1) + buf.lines[buf.row].slice(buf.col);
                buf.col--;
            } else if (buf.row > 0) {
                const prevLen = buf.lines[buf.row - 1].length;
                buf.lines[buf.row - 1] += buf.lines[buf.row];
                buf.lines.splice(buf.row, 1);
                buf.row--;
                buf.col = prevLen;
            }
            kick();
            return;
        }

        // Arrows
        if (key.leftArrow) { buf.col = Math.max(0, buf.col - 1); kick(); return; }
        if (key.rightArrow) { buf.col = Math.min(buf.lines[buf.row].length, buf.col + 1); kick(); return; }
        if (key.upArrow && buf.row > 0) {
            buf.row--;
            buf.col = Math.min(buf.col, buf.lines[buf.row].length);
            kick();
            return;
        }
        if (key.downArrow && buf.row < buf.lines.length - 1) {
            buf.row++;
            buf.col = Math.min(buf.col, buf.lines[buf.row].length);
            kick();
            return;
        }

        // Regular character input
        if (input && !key.ctrl && !key.meta) {
            buf.lines[buf.row] = buf.lines[buf.row].slice(0, buf.col) + input + buf.lines[buf.row].slice(buf.col);
            buf.col += input.length;
            kick();
        }
    });

    // Build display with cursor
    const minH = height || 3;
    const displayLines = [];
    for (let i = 0; i < Math.max(buf.lines.length, minH); i++) {
        if (i >= buf.lines.length) {
            displayLines.push(' ');
        } else if (i === buf.row && !disabled) {
            const line = buf.lines[i];
            const before = line.slice(0, buf.col);
            const cursorChar = line[buf.col] || ' ';
            const after = line.slice(buf.col + 1);
            displayLines.push(before + '\x1b[7m' + cursorChar + '\x1b[27m' + after);
        } else {
            displayLines.push(buf.lines[i] || ' ');
        }
    }

    return h(Text, null, displayLines.join('\n'));
}

// ─── App ────────────────────────────────────────────────────────────────────

function App({ pqueenPath, store, cwd, userName, connectionName, initialDisplayPos }) {
    const { exit } = useApp();
    const [busy, setBusy] = useState(false);
    const [costInfo, setCostInfo] = useState('');
    const pendingRef = useRef(null);
    const displayPosRef = useRef(initialDisplayPos);

    // When busy becomes true and we have pending text, wait one frame for
    // Ink to erase the box, then stream directly to process.stdout.
    useEffect(() => {
        if (!busy || !pendingRef.current) return;
        const text = pendingRef.current;
        pendingRef.current = null;

        const rawWrite = (s) => process.stdout.write(s);
        const colorize = (s) => s.replace(/@(\S+)/g, '\x1b[36m@$1\x1b[0m');

        // Build display output: undisplayed file content + user text (single write to avoid Ink interference)
        const fileContent = store.read();
        const undisplayed = fileContent.slice(displayPosRef.current);
        let displayOutput = undisplayed ? colorize(undisplayed) : '';
        displayOutput += text;
        if (!text.endsWith('\n')) displayOutput += '\n';
        rawWrite(displayOutput);

        // Append user text to file
        store.append(text);
        if (!text.endsWith('\n')) store.append('\n');
        displayPosRef.current = store.read().length;

        (async () => {
            const result = await runChatTurn(store, cwd, rawWrite, {});
            if (!result.failed && result.pricingResult) {
                setCostInfo(pricingToString(result.pricingResult));
            }
            if (!result.failed) {
                displayPosRef.current = result.displayPos;
            } else {
                displayPosRef.current = store.read().length;
            }
            setBusy(false);
        })();
    }, [busy]);

    const handleSubmit = useCallback((text) => {
        pendingRef.current = text;
        setBusy(true);
    }, []);

    useInput((_input, key) => {
        if (key.escape && !busy) {
            process.stdout.write(`\nSaved to ${pqueenPath}\n`);
            exit();
        }
    });

    // When busy, render a zero-height box so Ink doesn't reserve a blank line
    if (busy) {
        return h(Box, { height: 0 });
    }

    const statusParts = ['Ctrl+D send', 'Enter newline', 'Esc quit'];
    if (connectionName) statusParts.push(connectionName);
    if (costInfo) statusParts.push(costInfo);
    const hint = statusParts.join(' · ');

    return h(Box, { flexDirection: 'column' },
        h(Box, {
            borderStyle: 'round',
            borderColor: 'cyan',
            paddingLeft: 1,
            paddingRight: 1,
        },
            h(TextArea, { onSubmit: handleSubmit, height: 3, disabled: false })
        ),
        h(Text, { dimColor: true }, hint)
    );
}

// ─── Main ───────────────────────────────────────────────────────────────────

const pqueenPath = process.argv[2];
if (!pqueenPath) {
    console.error('Usage: chat-ink.mjs <file.pqueen>');
    process.exit(1);
}

const resolved = path.resolve(pqueenPath);
if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
}

// Initialize before Ink mounts — display conversation to raw stdout
const store = createFileStore(resolved);
const cwd = path.dirname(resolved);
const content = store.read();
const doc = pqutils.parseConfigAndMessages(content);
const resolvedConfig = pqutils.resolveConfig(doc.config, cwd);
const userName = resolvedConfig.roleplay_user || 'user';

displayConversation(store, cwd);

// Run postCompletionLint to prepare the file for user input (padding,
// next-speaker header).
const postConfig = { ...resolvedConfig, user: resolvedConfig.user || resolvedConfig.roleplay_user };
const postOutput = postCompletionLint(doc.messages, postConfig);
if (postOutput) {
    store.append(postOutput);
    const paddingMatch = postOutput.match(/^(\n+)/);
    if (paddingMatch) {
        process.stdout.write(paddingMatch[1]);
    }
}

const initialDisplayPos = store.read().length;

render(h(App, {
    pqueenPath: resolved,
    store,
    cwd,
    userName,
    connectionName: resolvedConfig.connection || '',
    initialDisplayPos,
}));
