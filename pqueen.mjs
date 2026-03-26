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
const { dispatchSendPrompt } = require('./lib/pipeline.js');
const { tokensToString } = require('./lib/send-prompt-common.js');
const pqutils = require('./lib/pq-utils.js');
const { SLASH_COMMANDS, cmdSubmitText, cmdFinishEditSpeaker } = require('./lib/commands.js');
const { filterLine } = require('./lib/stream-filter.js');

const h = React.createElement;

// ─── App ────────────────────────────────────────────────────────────────────

function App({ pqueenPath: initialPqueenPath, initialMessages, resolvedConfig, rawConfig, noSave }) {
    const { exit } = useApp();
    const [pqueenPath, setPqueenPath] = useState(initialPqueenPath);
    const cwd = useMemo(() => path.dirname(pqueenPath), [pqueenPath]);
    const initial = splitMessages(initialMessages);
    let initCompleted = initial.completed;
    let initPending = initial.pending;
    let initPrefill = '';
    if (!initPending && initCompleted.length > 0) {
        const last = initCompleted[initCompleted.length - 1];
        if (last.role === 'user' && !last.decorators?.includes('pq:hidden')) {
            // User message: pop into editor for continued editing
            initCompleted = initCompleted.slice(0, -1);
            initPrefill = last.content || '';
            initPending = { ...last, content: null, decorators: [] };
        } else {
            // Assistant/other role: determine next speaker via postCompletionLint
            const allMsgs = [...initCompleted];
            postCompletionLint(allMsgs, resolvedConfig);
            const nextSpeaker = allMsgs[allMsgs.length - 1];
            if (nextSpeaker && nextSpeaker.content === null) {
                initPending = nextSpeaker;
            }
        }
    }
    const [messages, setMessages] = useState(initCompleted);
    const [pendingMsg, setPendingMsg] = useState(initPending);
    const [busy, setBusy] = useState(false);
    const [costInfo, setCostInfo] = useState('');
    const cumulativeTokensRef = useRef({ prompt: 0, cached: 0, completion: 0 });
    const [streamLines, setStreamLines] = useState([]);
    const [streamPartial, setStreamPartial] = useState('');
    const [streamName, setStreamName] = useState('');
    const [streamToEditbox, setStreamToEditbox] = useState(false);
    const [error, setError] = useState('');
    const [prefill, setPrefill] = useState(initPrefill);
    const [staticKey, setStaticKey] = useState(0);
    const initCard = useMemo(() => readCharcardGreetings(resolvedConfig, cwd), []);
    const initGreetings = initCard && initCard.greetings.length > 1 ? initCard.greetings : null;
    const [generations, setGenerations] = useState(initGreetings || []);
    const [generationIdx, setGenerationIdx] = useState(initGreetings ? 0 : -1);
    const greetingGenerations = useRef(!!initGreetings);
    const [editingSpeaker, setEditingSpeaker] = useState(false);
    const abortRef = useRef(null);

    const speakerNames = useMemo(() => {
        const seen = new Set();
        const names = [];
        for (let i = messages.length - 1; i >= 0; i--) {
            const name = messages[i].name;
            if (name && !seen.has(name) && !messages[i].decorators?.includes('pq:hidden')) {
                seen.add(name);
                names.push(name);
            }
        }
        const rpUser = resolvedConfig.roleplay_user;
        if (rpUser && !seen.has(rpUser)) names.push(rpUser);
        for (const r of ['user', 'assistant', 'system']) {
            if (!seen.has(r)) names.push(r);
        }
        return names;
    }, [messages, resolvedConfig.roleplay_user]);

    const refreshScreen = useCallback(() => {
        process.stdout.write('\x1b[2J\x1b[H');
        setStaticKey(k => k + 1);
    }, []);

    // Returns { writer, flush } — completed lines go to streamLines (rendered
    // via Static, no re-render), current partial line to streamPartial (tiny
    // dynamic-area redraw).  No throttle needed since renders are cheap.
    // HTML comments (<!-- ... -->) are stripped from display output but
    // preserved in chunks for saving.
    const makeStreamWriter = useCallback(() => {
        const chunks = [];
        let buffer = '';
        let flushedLines = 0;
        let inComment = false;
        const flush = () => {
            const rawLines = buffer.split('\n');
            const rawCompleted = rawLines.slice(0, -1);
            if (rawCompleted.length > flushedLines) {
                const newDisplayLines = [];
                for (let i = flushedLines; i < rawCompleted.length; i++) {
                    const result = filterLine(rawCompleted[i], inComment);
                    inComment = result.inComment;
                    // Skip lines that become empty purely from comment removal
                    if (result.text === '' && rawCompleted[i].trim() !== '') continue;
                    newDisplayLines.push(result.text);
                }
                flushedLines = rawCompleted.length;
                setStreamLines(prev => [...prev, ...newDisplayLines]);
            }
            const partialRaw = rawLines[rawLines.length - 1];
            const { text: partialDisplay } = filterLine(partialRaw, inComment);
            setStreamPartial(partialDisplay);
        };
        const writer = {
            chunks,
            write(chunk) {
                chunks.push(chunk);
                buffer += chunk;
                flush();
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
        const prev = cumulativeTokensRef.current;
        const next = {
            prompt: prev.prompt + pricingResult.promptTokens,
            cached: prev.cached + pricingResult.cachedTokens,
            completion: prev.completion + pricingResult.completionTokens,
        };
        cumulativeTokensRef.current = next;
        setCostInfo(tokensToString(next.prompt, next.cached, next.completion));
    }, []);

    // Collect all messages including pending, for save/preview operations.
    const allMsgs = useMemo(() => {
        return pendingMsg ? [...messages, pendingMsg] : messages;
    }, [messages, pendingMsg]);

    const saveToPath = useCallback((filePath, msgs) => {
        fs.writeFileSync(filePath, pqutils.serializeDocument(rawConfig, msgs));
    }, [rawConfig]);

    useEffect(() => {
        const onResize = () => refreshScreen();
        process.stdout.on('resize', onResize);
        return () => process.stdout.off('resize', onResize);
    }, [refreshScreen]);

    // Re-seed greeting generations when user deletes back to a greeting message
    useEffect(() => {
        if (generations.length > 0 || messages.length === 0) return;
        const card = readCharcardGreetings(resolvedConfig, cwd);
        if (!card || card.greetings.length <= 1) return;
        const idx = card.greetings.indexOf(messages[messages.length - 1].content);
        if (idx >= 0) {
            setGenerations(card.greetings);
            setGenerationIdx(idx);
            greetingGenerations.current = true;
        }
    }, [messages, generations.length, resolvedConfig, cwd]);

    const saveFile = useCallback((msgs) => {
        if (noSave) return;
        fs.writeFileSync(pqueenPath, pqutils.serializeDocument(rawConfig, msgs));
    }, [pqueenPath, rawConfig, noSave]);

    // Stream a generation and run the post-completion pipeline.  Callers
    // control what happens on success/error via callbacks:
    //   onSuccess(content) → must return the full afterTurn message array
    //   onError(err)       → rollback state however the caller needs
    const runGeneration = useCallback(({ apiMessages, streamName: name, onSuccess, onError }) => {
        setStreamName(name);
        setBusy(true);
        setStreamLines([]);
        setStreamPartial('');

        (async () => {
            const tw = makeStreamWriter();
            try {
                const ac = new AbortController();
                const { content, pricingResult } = await streamCompletion(
                    apiMessages, ac, tw);

                const afterTurn = onSuccess(content);
                postCompletionLint(afterTurn, resolvedConfig);

                const lastMsg = afterTurn[afterTurn.length - 1];
                if (lastMsg.content === null) {
                    setPendingMsg(lastMsg);
                }

                saveFile(afterTurn);
                accumulateTokens(pricingResult);
            } catch (err) {
                if (err.name === 'AbortError') {
                    tw.flush();
                    let partial = tw.chunks.join('');
                    if (partial.endsWith('\n')) partial = partial.slice(0, -1);
                    if (partial) {
                        const afterTurn = onSuccess(partial);
                        postCompletionLint(afterTurn, resolvedConfig);

                        const lastMsg = afterTurn[afterTurn.length - 1];
                        if (lastMsg.content === null) {
                            setPendingMsg(lastMsg);
                        }

                        saveFile(afterTurn);
                    } else {
                        if (onError) onError(err);
                    }
                    setError('Request cancelled');
                } else {
                    if (onError) onError(err);
                    setError(`Error: ${err.message}`);
                }
            }
            refreshScreen();
            setStreamLines([]);
            setStreamPartial('');
            setStreamName('');
            setStreamToEditbox(false);
            setBusy(false);
        })();
    }, [resolvedConfig, streamCompletion, accumulateTokens, makeStreamWriter, saveFile, refreshScreen]);

    const handleCycleGeneration = useCallback((delta) => {
        const newIdx = generationIdx + delta;
        if (newIdx < 0) return;
        setError('');
        if (newIdx >= generations.length) {
            if (greetingGenerations.current) return;
            // Trigger a new regeneration when pressing right past the last generation
            const ctx = {
                allMsgs: pendingMsg ? [...messages, pendingMsg] : messages,
                messages, pendingMsg, resolvedConfig, cwd, pqueenPath,
                saveFile, saveToPath, runGeneration, refreshScreen,
                setMessages, setPendingMsg, setPrefill, setError, setStreamToEditbox,
                generations, setGenerations, setGenerationIdx,
            };
            SLASH_COMMANDS['/regenerate'](ctx);
            return;
        }
        setGenerationIdx(newIdx);
        const updated = [...messages];
        updated[updated.length - 1] = { ...updated[updated.length - 1], content: generations[newIdx] };
        setMessages(updated);
        const allUpdated = pendingMsg ? [...updated, pendingMsg] : updated;
        saveFile(allUpdated);
        refreshScreen();
    }, [generations, generationIdx, messages, pendingMsg, resolvedConfig, cwd, pqueenPath, saveFile, saveToPath, runGeneration, refreshScreen]);

    const handleSpeakerAccept = useCallback((name) => {
        if (!pendingMsg) return;
        const role = pqutils.PROMPT_ROLES.includes(name) ? name
            : name === resolvedConfig.roleplay_user ? 'user'
            : 'assistant';
        const updated = { ...pendingMsg, name, role };
        setPendingMsg(updated);
        saveFile([...messages, updated]);
        refreshScreen();
    }, [pendingMsg, messages, resolvedConfig, saveFile, refreshScreen]);

    const handleSubmit = useCallback((text) => {
        if (busy) return;
        setError('');
        setPrefill('');
        greetingGenerations.current = false;

        const ctx = {
            allMsgs, messages, pendingMsg, resolvedConfig, cwd, pqueenPath,
            saveFile, saveToPath, runGeneration, refreshScreen, exit,
            setMessages, setPendingMsg, setPrefill, setError, setStreamToEditbox,
            generations, setGenerations, setGenerationIdx,
            setEditingSpeaker,
            setPqueenPath,
        };

        if (editingSpeaker) {
            cmdFinishEditSpeaker(ctx, text);
            return;
        }

        const trimmed = text.trim();

        if (trimmed.startsWith('@') && !trimmed.includes('\n')) {
            const speakerName = trimmed.slice(1).trim();
            if (speakerName) {
                handleSpeakerAccept(speakerName);
                return;
            }
        }

        const handler = SLASH_COMMANDS[trimmed] || (trimmed === '' ? SLASH_COMMANDS['/generate'] : null);
        if (handler) {
            handler(ctx);
            return;
        }

        cmdSubmitText(ctx, text);
    }, [messages, pendingMsg, allMsgs, busy, resolvedConfig, cwd, pqueenPath, saveFile, saveToPath,
        runGeneration, refreshScreen, generations, editingSpeaker, handleSpeakerAccept]);

    useInput((_input, key) => {
        if ((key.escape || (key.ctrl && _input === 'c')) && busy) {
            if (abortRef.current) abortRef.current.abort();
        } else if (key.escape && !busy) {
            const allMsgs = pendingMsg ? [...messages, pendingMsg] : messages;
            saveFile(allMsgs);
            if (process.stderr.isTTY) process.stderr.write(noSave ? '\n' : `\nSaved to ${pqueenPath}\n`);
            exit();
        }
    });

    const generationInfo = generations.length > 1 ? `(${generationIdx + 1}/${generations.length})` : '';

    return h(ChatView, {
        messages, streamName, streamLines, streamPartial, streamToEditbox, pendingMsg,
        busy, connectionName: resolvedConfig.connection || '', costInfo, staticKey,
        onSubmit: handleSubmit,
        errorBanner: error,
        initialText: prefill,
        generationInfo,
        onCycleGeneration: handleCycleGeneration,
        speakerNames,
        onSpeakerAccept: handleSpeakerAccept,
    });
}

export { App };

// ─── Main ───────────────────────────────────────────────────────────────────

const { extractAiCardData } = require('./lib/card-utils.js');
const { sanitizeCardText } = require('./charcard-png-to-txt.js');
const { expandCBS } = require('./lib/render-template.js');
const { runSetup, testExistingConnection, wizardSelectConnection, updatePqueenConnection } = require('./lib/chat-setup.js');
const { chubFetch } = require('./chub-fetch.js');

function readCharcardGreetings(resolvedConfig, cwd) {
    if (!resolvedConfig.charcard) return null;
    const cardPath = path.resolve(cwd, resolvedConfig.charcard);
    if (!fs.existsSync(cardPath)) return null;
    const cardData = extractAiCardData(cardPath);
    const charName = (cardData.name || 'Character').replace(/[\r\n]+/g, ' ').trim();
    const cbsContext = { char: charName };
    if (resolvedConfig.roleplay_user) cbsContext.user = resolvedConfig.roleplay_user;
    const expandGreeting = (text) => sanitizeCardText(expandCBS(text, cbsContext));
    const greetings = [
        expandGreeting(cardData.first_mes || ''),
        ...(cardData.alternate_greetings || []).map(expandGreeting),
    ].filter(g => g);
    return greetings.length > 0 ? { charName, greetings } : null;
}

function isUrl(str) {
    return /^https?:\/\//i.test(str);
}

function isChubUrl(str) {
    return /^https?:\/\/(www\.)?chub\.ai\/characters\//i.test(str);
}

async function confirmOverwrite(dest) {
    const { promptTextInput } = require('./lib/tui.js');
    const answer = await promptTextInput(`${dest} already exists. Overwrite? [y/N] `);
    if (answer.trim().toLowerCase() !== 'y') {
        console.error('Aborted.');
        process.exit(1);
    }
}

async function downloadPng(url) {
    const res = await fetch(url, {
        headers: {
            'accept': '*/*',
            'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        },
    });
    if (!res.ok) throw new Error(`Failed to download PNG: ${res.status} ${res.statusText}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    // Derive filename from URL path
    const urlPath = new URL(url).pathname;
    const basename = path.basename(urlPath) || 'downloaded.png';
    const filename = basename.endsWith('.png') ? basename : basename + '.png';
    const dest = path.resolve(filename);
    if (fs.existsSync(dest)) await confirmOverwrite(dest);
    fs.writeFileSync(dest, buffer);
    console.error(`Downloaded ${dest}`);
    return dest;
}

async function main() {
    const args = process.argv.slice(2);
    const noSave = args.includes('--no-save');
    const dumpConfig = args.includes('--dump-config') || args.includes('--show-config');
    const listTemplates = args.includes('--list-templates');
    const configIdx = args.indexOf('--config-dir');
    let configDir;
    if (configIdx !== -1) {
        const configArg = args[configIdx + 1];
        if (!configArg || configArg.startsWith('--')) {
            console.error('--config-dir requires a path argument');
            process.exit(1);
        }
        configDir = path.resolve(configArg);
    }

    pqutils.ensureConfigDir(configDir);

    if (listTemplates) {
        const { discoverTemplates } = require('./lib/template-registry.js');
        const templates = discoverTemplates(configDir);
        if (templates.length === 0) {
            console.error('No templates found.');
            process.exit(0);
        }
        for (const t of templates) {
            console.log(t.id);
            console.log(`  Name: ${t.name}`);
            if (t.description) console.log(`  Description: ${t.description}`);
            console.log(`  Path: ${t.filePath}`);
            console.log();
        }
        process.exit(0);
    }

    const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--config-dir'));
    const inputPath = positional[0];
    if (!inputPath) {
        console.error('Usage: pqueen [--no-save] [--dump-config] [--list-templates] [--config-dir <path>] <file.png | file.pqueen | URL>');
        process.exit(1);
    }

    let resolved;

    if (isChubUrl(inputPath)) {
        console.error('Note: chub.ai downloading uses an unofficial API and may break without notice.');
        const { outputFilename } = await chubFetch(inputPath);
        resolved = path.resolve(outputFilename);
    } else if (isUrl(inputPath)) {
        resolved = await downloadPng(inputPath);
    } else {
        resolved = path.resolve(inputPath);
        if (!fs.existsSync(resolved)) {
            console.error(`File not found: ${resolved}`);
            process.exit(1);
        }
    }

    let pqueenPath;
    let cliConfig = {};

    if (resolved.endsWith('.png')) {
        const result = await runSetup(resolved, configDir);
        pqueenPath = result.pqueenPath;
    } else if (resolved.endsWith('.pqueen')) {
        pqueenPath = resolved;
    } else {
        console.error('Expected a .png or .pqueen file.');
        process.exit(1);
    }

    if (dumpConfig) {
        const cwd = path.dirname(pqueenPath);
        const content = fs.readFileSync(pqueenPath, 'utf8');
        const doc = pqutils.parseConfigAndMessages(content);
        const resolvedConfig = pqutils.resolveConfig(doc.config, cwd, {}, configDir);
        if (resolvedConfig.connection && resolvedConfig.connection_profiles) {
            const active = resolvedConfig.connection_profiles[resolvedConfig.connection];
            resolvedConfig.connection_profiles = { [resolvedConfig.connection]: active };
        } else {
            delete resolvedConfig.connection_profiles;
        }
        const yaml = (await import('js-yaml')).default;
        process.stdout.write(yaml.dump(resolvedConfig, { lineWidth: 120, noRefs: true }));
        process.exit(0);
    }

    // Ensure the file has a working connection configured
    const connectionOk = testExistingConnection(pqueenPath, cliConfig, configDir);
    if (!connectionOk) {
        const dotConfig = pqutils.loadDotConfig(configDir);
        const connResult = await wizardSelectConnection(dotConfig, configDir);
        cliConfig = connResult.cliConfig;
        if (noSave) {
            cliConfig.connection = connResult.connectionName;
        } else {
            updatePqueenConnection(pqueenPath, connResult.connectionName);
        }
    }

    const cwd = path.dirname(pqueenPath);
    const content = fs.readFileSync(pqueenPath, 'utf8');
    const doc = pqutils.parseConfigAndMessages(content);
    const resolvedConfig = pqutils.resolveConfig(doc.config, cwd, cliConfig, configDir);

    // For fresh charcard files (only hidden messages), inject greeting from PNG
    const isFresh = doc.messages.every(m => m.decorators?.includes('pq:hidden'));
    if (isFresh) {
        const card = readCharcardGreetings(resolvedConfig, cwd);
        if (card) {
            const charRole = card.charName === resolvedConfig.roleplay_user ? 'user' : 'assistant';
            doc.messages.push({
                name: card.charName, role: charRole,
                content: card.greetings[0], decorators: [],
            });
            const userName = resolvedConfig.roleplay_user || 'user';
            doc.messages.push({
                name: userName, role: 'user',
                content: null, decorators: [],
            });
            if (!noSave) {
                fs.writeFileSync(pqueenPath, pqutils.serializeDocument(doc.config, doc.messages));
            }
        }
    }

    // Clear any remaining setup output before starting the chat UI
    if (process.stderr.isTTY) process.stderr.write('\x1b[2J\x1b[H');

    render(h(App, {
        pqueenPath,
        initialMessages: doc.messages,
        resolvedConfig,
        rawConfig: doc.config,
        noSave,
    }), { exitOnCtrlC: false });
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === __filename) {
    main();
}
