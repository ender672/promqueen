import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Static, Box, Text, useInput, useApp } from 'ink';

const h = React.createElement;

// ─── Multi-line TextArea component ──────────────────────────────────────────

export function TextArea({ onSubmit, onChange, height, disabled, initialText, activeCommands, onCommandNav, onCommandAccept, onCycleGeneration }) {
    const { exit } = useApp();
    const bufRef = useRef({ lines: [''], row: 0, col: 0 });
    const prevInitialRef = useRef('');
    const historyRef = useRef([]);       // oldest first
    const historyIdxRef = useRef(-1);    // -1 = not browsing
    const savedInputRef = useRef('');    // input before entering history
    const [, forceRender] = useState(0);
    const kick = () => {
        forceRender(n => n + 1);
        if (onChange) onChange(bufRef.current.lines.join('\n'));
    };
    const buf = bufRef.current;

    if (initialText && initialText !== prevInitialRef.current) {
        buf.lines = initialText.split('\n');
        buf.row = buf.lines.length - 1;
        buf.col = buf.lines[buf.row].length;
        prevInitialRef.current = initialText;
    } else if (!initialText && prevInitialRef.current) {
        prevInitialRef.current = '';
    }

    useInput((input, key) => {
        if (disabled || key.escape) return;

        if (input === 'c' && key.ctrl) {
            const hasText = buf.lines.some(l => l.length > 0);
            if (hasText) {
                buf.lines = [''];
                buf.row = 0;
                buf.col = 0;
                kick();
            } else {
                exit();
            }
            return;
        }

        if (key.return) {
            // If autocomplete is showing, accept the selected command and submit it
            if (activeCommands && activeCommands.length > 0 && historyIdxRef.current === -1) {
                const accepted = onCommandAccept();
                if (accepted) {
                    historyIdxRef.current = -1;
                    const hist = historyRef.current;
                    if (hist.length === 0 || hist[hist.length - 1] !== accepted) {
                        hist.push(accepted);
                    }
                    onSubmit(accepted);
                    buf.lines = [''];
                    buf.row = 0;
                    buf.col = 0;
                    kick();
                    return;
                }
            }
            const text = buf.lines.join('\n').trim();
            if (text) {
                const hist = historyRef.current;
                if (hist.length === 0 || hist[hist.length - 1] !== text) {
                    hist.push(text);
                }
            }
            historyIdxRef.current = -1;
            onSubmit(text);
            buf.lines = [''];
            buf.row = 0;
            buf.col = 0;
            kick();
            return;
        }

        if (activeCommands && activeCommands.length > 0 && historyIdxRef.current === -1) {
            if (key.upArrow) { onCommandNav(-1); return; }
            if (key.downArrow) { onCommandNav(1); return; }
            if (key.tab) {
                const text = onCommandAccept();
                if (text) {
                    buf.lines = [text];
                    buf.row = 0;
                    buf.col = text.length;
                    kick();
                }
                return;
            }
        }

        if (key.backspace || key.delete) {
            historyIdxRef.current = -1;
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

        if (key.leftArrow) {
            if (onCycleGeneration && buf.lines.length === 1 && buf.lines[0] === '') {
                onCycleGeneration(-1); return;
            }
            if (key.ctrl || key.meta) {
                const line = buf.lines[buf.row];
                let c = buf.col - 1;
                while (c > 0 && /\s/.test(line[c])) c--;
                while (c > 0 && !/\s/.test(line[c - 1])) c--;
                buf.col = Math.max(0, c);
            } else {
                buf.col = Math.max(0, buf.col - 1);
            }
            kick(); return;
        }
        if (key.rightArrow) {
            if (onCycleGeneration && buf.lines.length === 1 && buf.lines[0] === '') {
                onCycleGeneration(1); return;
            }
            if (key.ctrl || key.meta) {
                const line = buf.lines[buf.row];
                let c = buf.col;
                while (c < line.length && !/\s/.test(line[c])) c++;
                while (c < line.length && /\s/.test(line[c])) c++;
                buf.col = c;
            } else {
                buf.col = Math.min(buf.lines[buf.row].length, buf.col + 1);
            }
            kick(); return;
        }
        if (key.upArrow) {
            if (buf.row > 0) {
                buf.row--;
                buf.col = Math.min(buf.col, buf.lines[buf.row].length);
            } else {
                // At top of buffer — browse history
                const hist = historyRef.current;
                if (hist.length > 0) {
                    if (historyIdxRef.current === -1) {
                        savedInputRef.current = buf.lines.join('\n');
                        historyIdxRef.current = hist.length - 1;
                    } else if (historyIdxRef.current > 0) {
                        historyIdxRef.current--;
                    }
                    const entry = hist[historyIdxRef.current];
                    buf.lines = entry.split('\n');
                    buf.row = buf.lines.length - 1;
                    buf.col = buf.lines[buf.row].length;
                }
            }
            kick();
            return;
        }
        if (key.downArrow) {
            if (buf.row < buf.lines.length - 1) {
                buf.row++;
                buf.col = Math.min(buf.col, buf.lines[buf.row].length);
            } else if (historyIdxRef.current !== -1) {
                // At bottom of buffer while browsing history — go forward
                const hist = historyRef.current;
                if (historyIdxRef.current < hist.length - 1) {
                    historyIdxRef.current++;
                    const entry = hist[historyIdxRef.current];
                    buf.lines = entry.split('\n');
                    buf.row = buf.lines.length - 1;
                    buf.col = buf.lines[buf.row].length;
                } else {
                    // Past the end — restore saved input
                    historyIdxRef.current = -1;
                    buf.lines = savedInputRef.current.split('\n');
                    buf.row = buf.lines.length - 1;
                    buf.col = buf.lines[buf.row].length;
                }
            }
            kick();
            return;
        }

        if (input === 'a' && key.ctrl) {
            buf.col = 0;
            kick(); return;
        }

        if (input && !key.ctrl && !key.meta) {
            historyIdxRef.current = -1;
            buf.lines[buf.row] = buf.lines[buf.row].slice(0, buf.col) + input + buf.lines[buf.row].slice(buf.col);
            buf.col += input.length;
            kick();
        }
    }, { isActive: !disabled, exitOnCtrlC: false });

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

// ─── Pure presentational component ──────────────────────────────────────────

export function splitMessages(msgs) {
    const last = msgs[msgs.length - 1];
    if (last && (!last.content || last.content.trim() === '')) {
        return { completed: msgs.slice(0, -1), pending: last };
    }
    return { completed: msgs, pending: null };
}

// Slash commands — tested against handleSubmit() in pqueen by
// tests/integration/chat-app.test.mjs "slash command lists stay in sync"
export const COMMANDS = [
    { name: '/exit', description: 'Quit' },
    { name: '/generate', description: 'LLM-generate current message' },
    { name: '/html', description: 'Preview as HTML in browser' },
    { name: '/regenerate', description: 'Regenerate last response' },
    { name: '/show-prompt', description: 'Preview prepared prompt' },
    { name: '/delete-last', description: 'Delete last message' },
    { name: '/edit-last', description: 'Edit last message' },
    { name: '/show-card', description: 'Open character card image' },
    { name: '/edit-speaker', description: 'Edit current speaker name' },
    { name: '/branch', description: 'Copy file and switch to it' },
];

function truncateStreamHead(buf) {
    // Keep only the tail of the streaming buffer so Ink's dynamic area
    // stays within the terminal height and doesn't cause jumpy re-renders.
    const maxLines = Math.max((process.stdout.rows || 24) - 10, 8);
    const lines = buf.split('\n');
    if (lines.length <= maxLines) return buf;
    return lines.slice(-maxLines).join('\n');
}

export function ChatView({ messages, streamName, streamLines, streamPartial, streamToEditbox, pendingMsg, busy, connectionName, costInfo, onSubmit, errorBanner, initialText, staticKey, generationInfo, onCycleGeneration }) {
    const [inputText, setInputText] = useState('');
    const [selectedIdx, setSelectedIdx] = useState(0);
    const trimmed = inputText.trim();
    const showCommands = trimmed.startsWith('/') && !busy;
    const filteredCommands = showCommands
        ? COMMANDS.filter(c => c.name.startsWith(trimmed))
        : [];

    useEffect(() => setSelectedIdx(0), [trimmed]);

    const statusParts = ['Enter send', '/html preview', 'Esc quit'];
    if (generationInfo) statusParts.push(generationInfo);
    if (connectionName) statusParts.push(connectionName);
    if (costInfo) statusParts.push(costInfo);
    const hint = statusParts.join(' · ');

    const visibleMessages = messages.filter(m => !m.decorators?.includes('pq:hidden'));

    // Combine messages and streaming lines into a single Static list.
    // Static only renders NEW items (no re-render), so completed stream
    // lines scroll up flicker-free.  Only streamPartial lives in the
    // dynamic area — one line max.
    const staticItems = useMemo(() => {
        const items = visibleMessages.map((msg, i) => ({ _t: 'm', msg, _k: `msg-${i}` }));
        if (streamName && !streamToEditbox) {
            items.push({ _t: 'sh', _k: 'sh' });
            for (let i = 0; i < streamLines.length; i++) {
                items.push({ _t: 'sl', text: streamLines[i], _k: `sl-${i}` });
            }
        }
        return items;
    }, [visibleMessages, streamName, streamToEditbox, streamLines]);

    const streamEditboxBuf = streamToEditbox ? [...streamLines, streamPartial].join('\n') : '';

    return h(Box, { flexDirection: 'column' },
        h(Static, { key: `static-${staticKey}`, items: staticItems }, (item, index) =>
            item._t === 'm'
                ? h(Box, { key: item._k, flexDirection: 'column', marginTop: index > 0 ? 1 : 0 },
                    item.msg.name ? h(Text, { color: 'cyan' }, `@${item.msg.name}`) : null,
                    item.msg.content ? h(Text, null, item.msg.content) : null,
                )
                : item._t === 'sh'
                    ? h(Box, { key: item._k, marginTop: 1 }, h(Text, { color: 'cyan' }, `@${streamName}`))
                    : h(Box, { key: item._k }, h(Text, null, item.text || ' '))
        ),
        streamPartial && !streamToEditbox ? h(Text, null, streamPartial) : null,
        pendingMsg && pendingMsg.name ? h(Box, { marginTop: 1 }, h(Text, { color: 'cyan' }, `@${pendingMsg.name}`)) : null,
        errorBanner ? h(Text, { color: 'red' }, errorBanner) : null,
        h(Box, {
            borderStyle: 'round',
            borderColor: errorBanner ? 'red' : busy ? 'gray' : 'cyan',
            paddingLeft: 1,
            paddingRight: 1,
        },
            streamToEditbox
                ? h(Text, null, streamEditboxBuf ? truncateStreamHead(streamEditboxBuf) : '')
                : h(TextArea, {
                onSubmit, onChange: setInputText, height: 3, disabled: busy, initialText, onCycleGeneration,
                activeCommands: filteredCommands.length > 0 ? filteredCommands : null,
                onCommandNav: (delta) => setSelectedIdx(i => {
                    const n = filteredCommands.length;
                    return ((i + delta) % n + n) % n;
                }),
                onCommandAccept: () => filteredCommands[selectedIdx]?.name,
            })
        ),
        filteredCommands.length > 0
            ? h(Box, { flexDirection: 'column', marginLeft: 1 },
                ...filteredCommands.map((c, i) =>
                    h(Text, { key: c.name },
                        i === selectedIdx ? h(Text, { color: 'cyan', bold: true }, `▸ ${c.name}`) : h(Text, { color: 'cyan' }, `  ${c.name}`),
                        h(Text, { dimColor: true }, `  ${c.description}`)
                    )
                )
            )
            : null,
        h(Text, { dimColor: true }, hint)
    );
}
