const { test } = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { extractAiCardDataFromBuffer } = require('../../lib/cardutils.js');

/**
 * Build a minimal valid PNG buffer with optional tEXt chunks.
 * @param {Array<{keyword: string, text: string}>} textChunks
 * @returns {Buffer}
 */
function buildPng(textChunks) {
    const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    function crc32(buf) {
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < buf.length; i++) {
            crc ^= buf[i];
            for (let j = 0; j < 8; j++) {
                crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
            }
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    function makeChunk(type, data) {
        const typeBuf = Buffer.from(type, 'ascii');
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32BE(data.length);
        const crcInput = Buffer.concat([typeBuf, data]);
        const crcBuf = Buffer.alloc(4);
        crcBuf.writeUInt32BE(crc32(crcInput));
        return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
    }

    // Minimal 1x1 RGB IHDR
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(1, 0);  // width
    ihdrData.writeUInt32BE(1, 4);  // height
    ihdrData[8] = 8;              // bit depth
    ihdrData[9] = 2;              // color type (RGB)

    // IDAT: zlib-compressed 1x1 RGB pixel (filter byte + R G B)
    const rawPixel = Buffer.from([0, 255, 0, 0]);
    const compressed = zlib.deflateSync(rawPixel);

    const parts = [PNG_SIGNATURE, makeChunk('IHDR', ihdrData)];

    for (const { keyword, text } of textChunks) {
        const keyBuf = Buffer.from(keyword, 'latin1');
        const nul = Buffer.from([0]);
        const valBuf = Buffer.from(text, 'latin1');
        parts.push(makeChunk('tEXt', Buffer.concat([keyBuf, nul, valBuf])));
    }

    parts.push(makeChunk('IDAT', compressed));
    parts.push(makeChunk('IEND', Buffer.alloc(0)));

    return Buffer.concat(parts);
}

/**
 * Build a base64-encoded JSON payload wrapping cardData under a "data" key.
 */
function encodeCardPayload(cardData) {
    return Buffer.from(JSON.stringify({ data: cardData })).toString('base64');
}

test('extractAiCardDataFromBuffer extracts ccv3 chunk', () => {
    const cardData = {
        name: 'TestChar',
        description: 'A test character',
        personality: 'Friendly',
    };
    const png = buildPng([
        { keyword: 'ccv3', text: encodeCardPayload(cardData) },
    ]);

    const result = extractAiCardDataFromBuffer(png);

    assert.deepStrictEqual(result, cardData);
});

test('extractAiCardDataFromBuffer falls back to chara chunk when no ccv3 exists', () => {
    const cardData = {
        name: 'CharaChar',
        description: 'A chara-only character',
        personality: 'Bold',
    };
    const png = buildPng([
        { keyword: 'chara', text: encodeCardPayload(cardData) },
    ]);

    const result = extractAiCardDataFromBuffer(png);

    assert.deepStrictEqual(result, cardData);
});
