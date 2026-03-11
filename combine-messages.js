function combineAdjacentMessages(messages) {
  return messages.reduce((acc, message) => {
    if (message.content === null) {
      acc.push({ ...message });
    } else if (acc.length > 0 && acc[acc.length - 1].role === message.role && acc[acc.length - 1].content !== null) {
      acc[acc.length - 1].content += '\n\n' + message.content;
    } else {
      acc.push({ ...message });
    }
    return acc;
  }, []);
}

module.exports = { combineAdjacentMessages };
