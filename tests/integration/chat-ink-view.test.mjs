import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import React from 'react';
import { render } from 'ink-testing-library';
import { ChatView } from '../../chat-ink-view.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '../fixtures/chat-ink-view');
// eslint-disable-next-line no-control-regex
const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, '');

const propFiles = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.props.json'));

for (const propFile of propFiles) {
    const baseName = propFile.replace('.props.json', '');
    const frameFile = path.join(fixturesDir, `${baseName}.frame.txt`);
    if (!fs.existsSync(frameFile)) continue;

    test(`chat-ink-view: ${baseName}`, () => {
        const props = JSON.parse(fs.readFileSync(path.join(fixturesDir, propFile), 'utf8'));
        props.onSubmit = () => {};

        const { lastFrame, cleanup } = render(React.createElement(ChatView, props));
        const actual = stripAnsi(lastFrame());
        const expected = fs.readFileSync(frameFile, 'utf8');

        assert.strictEqual(actual, expected,
            `Frame mismatch for ${baseName}.\n` +
            `Expected:\n${JSON.stringify(expected)}\n` +
            `Got:\n${JSON.stringify(actual)}`);
        cleanup();
    });
}
