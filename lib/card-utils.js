const fs = require('fs');
const extractChunks = require('png-chunks-extract');
const extractText = require('png-chunk-text');

/**
 * Extract AI card data from a PNG buffer.
 * Pure function — no filesystem I/O.
 */
function extractAiCardDataFromBuffer(buffer) {
    const chunks = extractChunks(buffer);

    const textChunks = chunks
        .filter(chunk => chunk.name === 'tEXt')
        .map(chunk => extractText.decode(chunk.data));

    // Priority: 'ccv3' -> 'chara'
    let charaChunk = textChunks.find(t => t.keyword === 'ccv3');
    if (!charaChunk) {
        charaChunk = textChunks.find(t => t.keyword === 'chara');
    }

    if (!charaChunk) {
        throw new Error('No character data found in image metadata.');
    }

    const decodedData = Buffer.from(charaChunk.text, 'base64').toString('utf8');
    const json = JSON.parse(decodedData);

    // Both Python scripts return data['data']
    return json.data;
}

/**
 * Extract AI card data from a PNG file path.
 * Convenience wrapper that reads the file then delegates to extractAiCardDataFromBuffer.
 */
function extractAiCardData(pngPath) {
    const buffer = fs.readFileSync(pngPath);
    return extractAiCardDataFromBuffer(buffer);
}

module.exports = {
    extractAiCardData,
    extractAiCardDataFromBuffer
};
