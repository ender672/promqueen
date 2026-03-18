const fs = require('fs');
const os = require('os');
const path = require('path');
const eventsourceParser = require('eventsource-parser');
const { expandEnvVars, serializeDocument } = require('./pq-utils.js');

async function* getStream(response) {
    const decoder = new TextDecoder('utf-8');
    let eventsToYield = [];

    const parser = eventsourceParser.createParser({
        onEvent: (event) => {
            eventsToYield.push(event);
        }
    });

    for await (const chunk of response.body) {
        const textChunk = decoder.decode(chunk, { stream: true });
        parser.feed(textChunk);

        for (const event of eventsToYield) {
            yield event;
        }

        eventsToYield = [];
    }
}

function unescapeMessages(messages) {
    return messages.map(message => {
        let content = message.content;
        if (content) {
            content = content.replace(/\\\{\{/g, '{{');
            content = content.replace(/\\\{%/g, '{%');
            content = content.replace(/^\\@/gm, '@');
        }
        return {
            role: message.role,
            content: content
        };
    });
}

function escapeContent(content, lastCharWasNewline) {
    content = content.replace(/\{\{/g, '\\{{');
    content = content.replace(/\{%/g, '\\{%');
    content = content.replace(/\n@/g, '\n\\@');
    if (lastCharWasNewline && content[0] === '@') {
        content = '\\' + content;
    }
    return { content, lastCharWasNewline: content.length > 0 && content.endsWith('\n') };
}

function escapeContentBlock(content) {
    content = content.replace(/\{\{/g, '\\{{');
    content = content.replace(/\{%/g, '\\{%');
    content = content.replace(/^@/gm, '\\@');
    return content;
}

function calculatePricing(pricing, promptTokens, cachedTokens, completionTokens) {
    const costUncached = (promptTokens - cachedTokens) / 1000000 * pricing.cost_uncached;
    const costCached = cachedTokens / 1000000 * pricing.cost_cached;
    const costOutput = completionTokens / 1000000 * pricing.cost_output;
    const costTotal = costUncached + costCached + costOutput;
    const requestsPerPenny = 1 / costTotal;

    let cachedPercentage = 0;
    if (promptTokens > 0) {
        cachedPercentage = (cachedTokens / promptTokens) * 100;
    }

    return {
        costTotal,
        requestsPerPenny,
        costUncached,
        costCached,
        costOutput,
        cachedPercentage,
        promptTokens,
        cachedTokens,
        completionTokens,
    };
}

function pricingToString(p) {
    return `total cost: ${p.costTotal.toFixed(5)}¢, reqs/cent: ${p.requestsPerPenny.toFixed(2)}, uncached: ${p.costUncached.toFixed(5)}¢, cached: ${p.costCached.toFixed(5)}¢, output: ${p.costOutput.toFixed(5)}¢, ${p.cachedPercentage.toFixed(1)}% cached`;
}

function tokensToString(promptTokens, cachedTokens, completionTokens) {
    const parts = [`in: ${promptTokens}`];
    if (cachedTokens > 0) parts.push(`cached: ${cachedTokens}`);
    parts.push(`out: ${completionTokens}`);
    return parts.join(', ');
}

function resolveDebugDir(resolvedConfig) {
    if (!resolvedConfig.debug_log_path) return null;
    const raw = resolvedConfig.debug_log_path.startsWith('~/')
        ? path.join(os.homedir(), resolvedConfig.debug_log_path.slice(2))
        : resolvedConfig.debug_log_path;
    const debugDir = path.resolve(raw);
    if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
    }
    return debugDir;
}

function debugLogBody(resolvedConfig, body) {
    const debugDir = resolveDebugDir(resolvedConfig);
    if (debugDir) {
        const debugPath = path.join(debugDir, 'last_request_payload.json');
        fs.writeFileSync(debugPath, JSON.stringify(body, null, 2));
    }
}

function debugLogFinalPqueen(resolvedConfig, messages) {
    const debugDir = resolveDebugDir(resolvedConfig);
    if (debugDir) {
        const debugPath = path.join(debugDir, 'last_request_final.pqueen');
        fs.writeFileSync(debugPath, serializeDocument(resolvedConfig, messages));
    }
}

async function sendRequest(connProfile, body, options) {
    const response = await fetch(connProfile.api_url, {
        method: 'POST',
        headers: expandEnvVars(connProfile.api_call_headers || {}),
        body: JSON.stringify(body),
        signal: options.signal,
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }
    return response;
}

module.exports = {
    getStream,
    unescapeMessages,
    escapeContent,
    escapeContentBlock,
    calculatePricing,
    pricingToString,
    tokensToString,
    debugLogBody,
    debugLogFinalPqueen,
    sendRequest,
};
