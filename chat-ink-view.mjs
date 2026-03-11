import React, { useRef, useState, useEffect } from 'react';
import { Static, Box, Text, useInput } from 'ink';

const h = React.createElement;

// ─── Multi-line TextArea component ──────────────────────────────────────────

export function TextArea({ onSubmit, onChange, height, disabled, initialText, activeCommands, onCommandNav, onCommandAccept }) {
    const bufRef = useRef({ lines: [''], row: 0, col: 0 });
    const prevInitialRef = useRef('');
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

        if (key.return) {
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

        if (activeCommands && activeCommands.length > 0) {
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

// ─── Pure presentational component ──────────────────────────────────────────

export function splitMessages(msgs) {
    const last = msgs[msgs.length - 1];
    if (last && (!last.content || last.content.trim() === '')) {
        return { completed: msgs.slice(0, -1), pending: last };
    }
    return { completed: msgs, pending: null };
}

const COMMANDS = [
    { name: '/exit', description: 'Save and quit' },
    { name: '/html', description: 'Preview as HTML in browser' },
    { name: '/regenerate', description: 'Regenerate last response' },
    { name: '/show-prompt', description: 'Preview prepared prompt' },
];

export function ChatView({ messages, streamName, streamBuf, pendingMsg, sentMsg, busy, connectionName, costInfo, onSubmit, errorBanner, initialText, staticKey }) {
    const [inputText, setInputText] = useState('');
    const [selectedIdx, setSelectedIdx] = useState(0);
    const trimmed = inputText.trim();
    const showCommands = trimmed.startsWith('/') && !busy;
    const filteredCommands = showCommands
        ? COMMANDS.filter(c => c.name.startsWith(trimmed))
        : [];

    useEffect(() => setSelectedIdx(0), [trimmed]);

    const statusParts = ['Enter send', '/html preview', 'Esc quit'];
    if (connectionName) statusParts.push(connectionName);
    if (costInfo) statusParts.push(costInfo);
    const hint = statusParts.join(' · ');

    const visibleMessages = messages.filter(m => !m.decorators?.includes('pq:hidden'));

    return h(Box, { flexDirection: 'column' },
        h(Static, { key: `static-${staticKey}`, items: visibleMessages }, (msg, index) =>
            h(Box, { key: `msg-${index}`, flexDirection: 'column', marginTop: index > 0 ? 1 : 0 },
                msg.name ? h(Text, { color: 'cyan' }, `@${msg.name}`) : null,
                msg.content ? h(Text, null, msg.content.replace(/\n$/, '')) : null,
            )
        ),
        sentMsg ? h(Box, { flexDirection: 'column', marginTop: 1 },
            sentMsg.name ? h(Text, { color: 'cyan' }, `@${sentMsg.name}`) : null,
            sentMsg.content ? h(Text, null, sentMsg.content.replace(/\n$/, '')) : null,
        ) : null,
        streamName ? h(Box, { flexDirection: 'column', marginTop: 1 },
            h(Text, { color: 'cyan' }, `@${streamName}`),
            streamBuf ? h(Text, null, streamBuf) : null,
        ) : null,
        pendingMsg && pendingMsg.name ? h(Box, { marginTop: 1 }, h(Text, { color: 'cyan' }, `@${pendingMsg.name}`)) : null,
        errorBanner ? h(Text, { color: 'red' }, errorBanner) : null,
        h(Box, {
            borderStyle: 'round',
            borderColor: errorBanner ? 'red' : busy ? 'gray' : 'cyan',
            paddingLeft: 1,
            paddingRight: 1,
        },
            h(TextArea, {
                onSubmit, onChange: setInputText, height: 3, disabled: busy, initialText,
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
