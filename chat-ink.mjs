#!/usr/bin/env node

import { createRequire } from 'module';
import React, { useState, useCallback } from 'react';
import { render, useInput, useApp } from 'ink';
import { ChatView, splitMessages } from './chat-ink-view.mjs';

const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const { precompletionLint } = require('./pre-completion-lint.js');
const { postCompletionLint } = require('./post-completion-lint.js');
const { preparePrompt, dispatchSendPrompt } = require('./lib/pipeline.js');
const { pricingToString } = require('./lib/send-prompt-common.js');
const pqutils = require('./lib/pq-utils.js');

const h = React.createElement;

// ─── App ────────────────────────────────────────────────────────────────────

function App({ pqueenPath, cwd, connectionName, initialMessages, resolvedConfig, rawConfig }) {
    const { exit } = useApp();
    const initial = splitMessages(initialMessages);
    const [messages, setMessages] = useState(initial.completed);
    const [pendingMsg, setPendingMsg] = useState(initial.pending);
    const [busy, setBusy] = useState(false);
    const [costInfo, setCostInfo] = useState('');
    const [streamBuf, setStreamBuf] = useState('');
    const [streamName, setStreamName] = useState('');

    const saveFile = useCallback((msgs) => {
        fs.writeFileSync(pqueenPath, pqutils.serializeDocument(rawConfig, msgs));
    }, [pqueenPath, rawConfig]);

    const handleSubmit = useCallback((text) => {
        // Fill the pending message and promote it to completed
        const filled = { ...pendingMsg, content: (pendingMsg.content || '') + text + '\n' };
        const allMessages = [...messages, filled];
        setMessages(allMessages);
        setPendingMsg(null);
        saveFile(allMessages);

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

                const afterTurn = [...allMessages, assistantMsg];
                setMessages(prev => [...prev, assistantMsg]);

                // Run post-completion lint to determine next speaker
                const postConfig = { ...resolvedConfig, user: resolvedConfig.user || resolvedConfig.roleplay_user };
                postCompletionLint(afterTurn, postConfig);

                // If postCompletionLint pushed a next speaker, use it as pending
                const lastMsg = afterTurn[afterTurn.length - 1];
                if (lastMsg.content === null) {
                    setPendingMsg(lastMsg);
                }

                saveFile(afterTurn);

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
    }, [messages, pendingMsg, resolvedConfig, cwd, saveFile]);

    useInput((_input, key) => {
        if (key.escape && !busy) {
            const allMsgs = pendingMsg ? [...messages, pendingMsg] : messages;
            saveFile(allMsgs);
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

const { runSetup } = require('./lib/chat-setup.js');

async function main() {
    const inputPath = process.argv[2];
    if (!inputPath) {
        console.error('Usage: chat-ink.mjs <file.png | file.pqueen>');
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

    render(h(App, {
        pqueenPath,
        cwd,
        connectionName: resolvedConfig.connection || '',
        initialMessages: doc.messages,
        resolvedConfig,
        rawConfig: doc.config,
    }));
}

main();
