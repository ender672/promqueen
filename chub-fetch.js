#!/usr/bin/env node

const fs = require('fs');
const extractChunks = require('png-chunks-extract');
const encodeChunks = require('png-chunks-encode');
const encodeText = require('png-chunk-text').encode;

const COMMON_HEADERS = {
    'accept': '*/*',
    'origin': 'https://chub.ai',
    'referer': 'https://chub.ai/',
};

function parseChubUrl(url) {
    const match = url.match(/chub\.ai\/characters\/(.+)$/);
    if (!match) throw new Error(`Invalid chub.ai URL: ${url}`);
    return match[1]; // e.g. "thecooler/bilinda-fd62bae79ea0"
}

async function fetchCharacterInfo(charPath) {
    const nocache = Math.random();
    const url = `https://gateway.chub.ai/api/characters/${charPath}?full=true&nocache=${nocache}`;
    const res = await fetch(url, { headers: COMMON_HEADERS });
    if (!res.ok) throw new Error(`Failed to fetch character info: ${res.status} ${res.statusText}`);
    return res.json();
}

async function fetchCardJson(projectId) {
    const url = `https://gateway.chub.ai/api/v4/projects/${projectId}/repository/files/card.json/raw?ref=main&response_type=blob`;
    const res = await fetch(url, { headers: COMMON_HEADERS });
    if (!res.ok) throw new Error(`Failed to fetch card.json: ${res.status} ${res.statusText}`);
    return res.json();
}

async function fetchAvatar(charPath) {
    const url = `https://avatars.charhub.io/avatars/${charPath}/chara_card_v2.png`;
    const res = await fetch(url, {
        headers: COMMON_HEADERS,
    });
    if (!res.ok) throw new Error(`Failed to fetch avatar: ${res.status} ${res.statusText}`);
    return Buffer.from(await res.arrayBuffer());
}

function embedCardInPng(pngBuffer, cardJson) {
    const chunks = extractChunks(pngBuffer);

    // Remove any existing chara/ccv3 tEXt chunks
    const filtered = chunks.filter(chunk => {
        if (chunk.name !== 'tEXt') return true;
        const decoded = require('png-chunk-text').decode(chunk.data);
        return decoded.keyword !== 'chara' && decoded.keyword !== 'ccv3';
    });

    // Encode card JSON as base64 and insert as ccv3 tEXt chunk before IEND
    const base64Card = Buffer.from(JSON.stringify(cardJson), 'utf8').toString('base64');
    const textChunk = encodeText('ccv3', base64Card);

    // Also add a chara chunk for V2 backfill compatibility
    const charaChunk = encodeText('chara', base64Card);

    // Insert before IEND (last chunk)
    const iend = filtered.pop();
    filtered.push(textChunk, charaChunk, iend);

    return Buffer.from(encodeChunks(filtered));
}

function buildOutputFilename(charPath) {
    // charPath is e.g. "thecooler/bilinda-fd62bae79ea0"
    const slug = charPath.split('/').pop(); // "bilinda-fd62bae79ea0"
    return `main_${slug}_spec_v2.png`;
}

async function chubFetch(chubUrl) {
    const charPath = parseChubUrl(chubUrl);

    console.error(`Fetching character info for ${charPath}...`);
    const info = await fetchCharacterInfo(charPath);
    const projectId = info.node.id;
    if (typeof projectId !== 'number') throw new Error(`Expected numeric id, got: ${projectId}`);
    console.error(`Project ID: ${projectId}`);

    console.error('Fetching card.json...');
    const cardJson = await fetchCardJson(projectId);

    console.error('Fetching avatar PNG...');
    const pngBuffer = await fetchAvatar(charPath);

    console.error('Embedding card data in PNG...');
    const outputBuffer = embedCardInPng(pngBuffer, cardJson);

    const outputFilename = buildOutputFilename(charPath);
    if (fs.existsSync(outputFilename)) {
        const { promptTextInput } = require('./lib/tui.js');
        const answer = await promptTextInput(`${outputFilename} already exists. Overwrite? [y/N] `);
        if (answer.trim().toLowerCase() !== 'y') {
            console.error('Aborted.');
            process.exit(1);
        }
    }
    fs.writeFileSync(outputFilename, outputBuffer);
    console.error(`Wrote ${outputFilename}`);

    return { outputFilename, cardJson };
}

function main() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error('Usage: node chub-fetch.js <chub.ai URL>');
        console.error('Example: node chub-fetch.js https://chub.ai/characters/thecooler/bilinda-fd62bae79ea0');
        process.exit(1);
    }
    chubFetch(args[0]).catch(err => {
        console.error(err.message);
        process.exit(1);
    });
}

if (require.main === module) {
    main();
}

module.exports = { chubFetch };
