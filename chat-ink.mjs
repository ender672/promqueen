#!/usr/bin/env node

import { createRequire } from 'module';
import React, { useState, useCallback } from 'react';
import { render, useInput, useApp } from 'ink';
import { ChatView, splitMessages } from './chat-ink-view.mjs';

const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const { precompletionLint } = require('./pre-completion-lint.js');
const { preparePrompt, dispatchSendPrompt } = require('./lib/pipeline.js');
const { pricingToString } = require('./lib/send-prompt-common.js');
const pqutils = require('./lib/pq-utils.js');

const h = React.createElement;

// ─── App ────────────────────────────────────────────────────────────────────

function App({ pqueenPath, cwd, connectionName, initialMessages, resolvedConfig }) {
    const { exit } = useApp();
    const initial = splitMessages(initialMessages);
    const [messages, setMessages] = useState(initial.completed);
    const [pendingMsg, setPendingMsg] = useState(initial.pending);
    const [busy, setBusy] = useState(false);
    const [costInfo, setCostInfo] = useState('');
    const [streamBuf, setStreamBuf] = useState('');
    const [streamName, setStreamName] = useState('');

    const handleSubmit = useCallback((text) => {
        // Fill the pending message and promote it to completed
        const filled = { ...pendingMsg, content: (pendingMsg.content || '') + text + '\n' };
        const allMessages = [...messages, filled];
        setMessages(allMessages);
        setPendingMsg(null);

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

                const assistantMsg = {
                    name: assistantName,
                    role: assistantRole,
                    content,
                    decorators: [],
                };

                // Add assistant response to completed, set up next pending user slot
                const afterTurn = [...allMessages, assistantMsg];
                const next = splitMessages(afterTurn);
                setMessages(prev => [...prev, assistantMsg]);
                // Guess next speaker for the pending slot
                const postConfig = { ...resolvedConfig, user: resolvedConfig.user || resolvedConfig.roleplay_user };
                const nextSpeaker = pqutils.guessNextSpeaker(afterTurn, postConfig.user);
                if (nextSpeaker) {
                    const nextRole = pqutils.PROMPT_ROLES.includes(nextSpeaker) ? nextSpeaker : 'user';
                    setPendingMsg({ name: nextSpeaker, role: nextRole, content: null, decorators: [] });
                }

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
    }, [messages, pendingMsg, resolvedConfig, cwd]);

    useInput((_input, key) => {
        if (key.escape && !busy) {
            process.stdout.write(`\nSaved to ${pqueenPath}\n`);
            exit();
        }
    });

    return h(ChatView, {
        messages, streamName, streamBuf, pendingMsg,
        busy, connectionName, costInfo,
        onSubmit: handleSubmit,
    });
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
