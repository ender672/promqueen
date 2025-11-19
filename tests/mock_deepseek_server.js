const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });

    const chunks = [
        {
            choices: [{ delta: { content: 'if n == 0:\n' } }],
        },
        {
            choices: [{ delta: { content: '        return 1\n' } }],
        },
        {
            choices: [{ delta: { content: '    else:\n' } }],
        },
        {
            choices: [{ delta: { content: '        return n * factorial(n-1)' } }],
        }
    ];

    let i = 0;
    const interval = setInterval(() => {
        if (i < chunks.length) {
            res.write(`data: ${JSON.stringify(chunks[i])}\n\n`);
            i++;
        } else {
            res.write('data: [DONE]\n\n');
            clearInterval(interval);
            res.end();
        }
    }, 10);
});

if (require.main === module) {
    const PORT = 4000;
    server.listen(PORT, () => {
        console.log(`Mock DeepSeek server running on port ${PORT}`);
    });
}

module.exports = server;
