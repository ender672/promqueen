#!/usr/bin/env node

import { createRequire } from 'module';
import React, { useState, useCallback, useRef } from 'react';
import { render, Static, Box, Text, useInput, useApp } from 'ink';

const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const { precompletionLint } = require('./pre-completion-lint.js');
const { preparePrompt, dispatchSendPrompt } = require('./lib/pipeline.js');
const { pricingToString } = require('./lib/send-prompt-common.js');
const pqutils = require('./lib/pq-utils.js');

const h = React.createElement;

// ─── Multi-line TextArea component ──────────────────────────────────────────

function TextArea({ onSubmit, height, disabled }) {
    const bufRef = useRef({ lines: [''], row: 0, col: 0 });
    const [, forceRender] = useState(0);
    const kick = () => forceRender(n => n + 1);
    const buf = bufRef.current;

    useInput((input, key) => {
        if (disabled || key.escape) return;

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

        if (key.return) {
            const before = buf.lines[buf.row].slice(0, buf.col);
            const after = buf.lines[buf.row].slice(buf.col);
            buf.lines.splice(buf.row, 1, before, after);
            buf.row++;
            buf.col = 0;
            kick();
            return;
        }

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

        if (input && !key.ctrl && !key.meta) {
            buf.lines[buf.row] = buf.lines[buf.row].slice(0, buf.col) + input + buf.lines[buf.row].slice(buf.col);
            buf.col += input.length;
            kick();
        }
    });

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

function App({ pqueenPath, cwd, connectionName, initialMessages, resolvedConfig }) {
    const { exit } = useApp();
    const [messages, setMessages] = useState(initialMessages);
    const [busy, setBusy] = useState(false);
    const [costInfo, setCostInfo] = useState('');
    const [streamBuf, setStreamBuf] = useState('');
    const [streamName, setStreamName] = useState('');

    const handleSubmit = useCallback((text) => {
        const userName = resolvedConfig.roleplay_user || 'user';
        const userRole = pqutils.PROMPT_ROLES.includes(userName) ? userName : 'user';

        // If the last message is an empty slot for this user, fill it instead of creating a new one
        const last = messages[messages.length - 1];
        let allMessages;
        if (last && last.name === userName && (!last.content || last.content.trim() === '')) {
            allMessages = [...messages];
            allMessages[allMessages.length - 1] = { ...last, content: text + '\n' };
        } else {
            const userMsg = { name: userName, role: userRole, content: text + '\n', decorators: [] };
            allMessages = [...messages, userMsg];
        }
        setMessages(allMessages);

        // Clone and run precompletionLint to set up the assistant's empty message
        const msgsForApi = structuredClone(allMessages);
        precompletionLint(msgsForApi, resolvedConfig);
        const assistantEntry = msgsForApi[msgsForApi.length - 1];
        const assistantName = assistantEntry.name;
        const assistantRole = assistantEntry.role || 'assistant';

        const apiMessages = preparePrompt(msgsForApi, resolvedConfig, cwd, cwd);

        setStreamName(assistantName);
        setBusy(true);
        setStreamBuf('');

        (async () => {
            const chunks = [];
            try {
                const pricingResult = await dispatchSendPrompt(apiMessages, resolvedConfig, {
                    write(chunk) {
                        setStreamBuf(buf => buf + chunk);
                        chunks.push(chunk);
                    }
                }, cwd, {});

                let content = chunks.join('');
                if (content && !content.endsWith('\n')) content += '\n';

                setMessages(prev => [...prev, {
                    name: assistantName,
                    role: assistantRole,
                    content,
                    decorators: [],
                }]);

                if (pricingResult) setCostInfo(pricingToString(pricingResult));
            } catch (err) {
                if (err.name === 'AbortError') {
                    setStreamBuf('[cancelled]');
                } else {
                    setStreamBuf(`Error: ${err.message}`);
                }
            }
            setStreamBuf('');
            setStreamName('');
            setBusy(false);
        })();
    }, [messages, resolvedConfig, cwd]);

    useInput((_input, key) => {
        if (key.escape && !busy) {
            process.stdout.write(`\nSaved to ${pqueenPath}\n`);
            exit();
        }
    });

    const statusParts = ['Ctrl+D send', 'Enter newline', 'Esc quit'];
    if (connectionName) statusParts.push(connectionName);
    if (costInfo) statusParts.push(costInfo);
    const hint = statusParts.join(' · ');

    return h(Box, { flexDirection: 'column' },
        h(Static, { items: messages }, (msg, index) =>
            h(Box, { key: `msg-${index}`, flexDirection: 'column', marginTop: index > 0 ? 1 : 0 },
                msg.name ? h(Text, { color: 'cyan' }, `@${msg.name}`) : null,
                msg.content ? h(Text, null, msg.content.replace(/\n$/, '')) : null,
            )
        ),
        streamName ? h(Box, { flexDirection: 'column', marginTop: 1 },
            h(Text, { color: 'cyan' }, `@${streamName}`),
            streamBuf ? h(Text, null, streamBuf) : null,
        ) : null,
        h(Box, {
            borderStyle: 'round',
            borderColor: busy ? 'gray' : 'cyan',
            paddingLeft: 1,
            paddingRight: 1,
        },
            h(TextArea, { onSubmit: handleSubmit, height: 3, disabled: busy })
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

const cwd = path.dirname(resolved);
const content = fs.readFileSync(resolved, 'utf8');
const doc = pqutils.parseConfigAndMessages(content);
const resolvedConfig = pqutils.resolveConfig(doc.config, cwd);

render(h(App, {
    pqueenPath: resolved,
    cwd,
    connectionName: resolvedConfig.connection || '',
    initialMessages: doc.messages,
    resolvedConfig,
}));
