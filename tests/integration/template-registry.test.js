const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { parseTemplateMetadata, discoverTemplates, resolveTemplatePath } = require('../../lib/template-registry.js');

test('parseTemplateMetadata extracts name and description', () => {
    const text = `{# ---
name: My Template
description: A test template.
--- #}
Some content`;
    const meta = parseTemplateMetadata(text);
    assert.deepStrictEqual(meta, { name: 'My Template', description: 'A test template.' });
});

test('parseTemplateMetadata returns null for text without metadata', () => {
    const text = '---\nroleplay_user: user\n---\n@system\nHello';
    assert.strictEqual(parseTemplateMetadata(text), null);
});

test('parseTemplateMetadata handles name-only metadata', () => {
    const text = `{# ---
name: Just a Name
--- #}
content`;
    const meta = parseTemplateMetadata(text);
    assert.strictEqual(meta.name, 'Just a Name');
    assert.strictEqual(meta.description, undefined);
});

test('discoverTemplates finds templates in ~/.promqueen-templates/', (t) => {
    const originalHomedir = os.homedir;
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pq-tmpl-'));
    const userDir = path.join(fakeHome, '.promqueen-templates');
    fs.mkdirSync(userDir);
    fs.writeFileSync(path.join(userDir, 'my-template.jinja'), `{# ---
name: My Template
description: A custom template.
--- #}
content`);
    fs.writeFileSync(path.join(userDir, 'bare.jinja'), 'no metadata here');

    os.homedir = () => fakeHome;
    t.after(() => {
        os.homedir = originalHomedir;
        fs.rmSync(fakeHome, { recursive: true, force: true });
    });

    const registryPath = require.resolve('../../lib/template-registry.js');
    delete require.cache[registryPath];
    const fresh = require('../../lib/template-registry.js');

    const templates = fresh.discoverTemplates();
    assert.strictEqual(templates.length, 2);

    const withMeta = templates.find(t => t.id === 'my-template');
    assert.ok(withMeta);
    assert.strictEqual(withMeta.name, 'My Template');
    assert.strictEqual(withMeta.description, 'A custom template.');

    const bare = templates.find(t => t.id === 'bare');
    assert.ok(bare);
    assert.strictEqual(bare.name, 'bare');
    assert.strictEqual(bare.description, '');

    delete require.cache[registryPath];
    require('../../lib/template-registry.js');
});

test('discoverTemplates returns empty array when dir does not exist', (t) => {
    const originalHomedir = os.homedir;
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pq-tmpl-empty-'));
    os.homedir = () => fakeHome;
    t.after(() => {
        os.homedir = originalHomedir;
        fs.rmSync(fakeHome, { recursive: true, force: true });
    });

    const registryPath = require.resolve('../../lib/template-registry.js');
    delete require.cache[registryPath];
    const fresh = require('../../lib/template-registry.js');

    const templates = fresh.discoverTemplates();
    assert.strictEqual(templates.length, 0);

    delete require.cache[registryPath];
    require('../../lib/template-registry.js');
});

test('resolveTemplatePath resolves a known template id', () => {
    const templates = discoverTemplates();
    if (templates.length === 0) return;
    const first = templates[0];
    const resolved = resolveTemplatePath(first.id);
    assert.strictEqual(resolved, first.filePath);
});

test('resolveTemplatePath returns absolute path for unknown identifier', () => {
    const resolved = resolveTemplatePath('/some/absolute/path.jinja');
    assert.strictEqual(resolved, '/some/absolute/path.jinja');
});

test('resolveTemplatePath returns null for empty input', () => {
    assert.strictEqual(resolveTemplatePath(''), null);
    assert.strictEqual(resolveTemplatePath(null), null);
    assert.strictEqual(resolveTemplatePath(undefined), null);
});
