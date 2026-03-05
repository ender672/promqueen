function applyExtraInstructions(messages) {
    return messages.map(m => {
        if (!m.extra_instructions || m.extra_instructions.length === 0) return m;
        return {
            ...m,
            content: (m.content || '') + '\n\n' + m.extra_instructions.join('\n'),
            extra_instructions: undefined
        };
    });
}

module.exports = { applyExtraInstructions };
