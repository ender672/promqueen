const fs = require('fs');
const extractChunks = require('png-chunks-extract');
const extractText = require('png-chunk-text');

/**
 * Common function to extract AI card data from a PNG.
 * Used by both the name printer and the ChatML generator.
 */
function extractAiCardData(pngPath) {
    const buffer = fs.readFileSync(pngPath);
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

module.exports = {
    extractAiCardData
};
