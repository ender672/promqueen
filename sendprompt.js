#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const process = require('process');
const eventsourceParser = require('eventsource-parser');
const commander = require('commander');
const pqutils = require('./lib/pqutils.js');

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

function usageToCostString(pricing, usage) {
  const cachedTokens = usage["prompt_tokens_details"]["cached_tokens"];
  const costUncached = (usage["prompt_tokens"] - cachedTokens) / 1000000 * pricing.cost_uncached;
  const costCached = cachedTokens / 1000000 * pricing.cost_cached;
  const costOutput = usage["completion_tokens"] / 1000000 * pricing.cost_output;
  const costTotal = costUncached + costCached + costOutput;
  const requestsPerPenny = 1 / costTotal;
  return `total cost (cents): ${costTotal.toFixed(5)}, requests per penny: ${requestsPerPenny.toFixed(2)}, uncached in: ${costUncached.toFixed(5)}, cached in: ${costCached.toFixed(5)}, output: ${costOutput.toFixed(5)}`;
}

async function sendPrompt(options, outputStream = process.stdout, errorStream = process.stderr) {
  const { promptPath, attachment } = options;

  const resolvedPath = path.resolve(promptPath);
  const fileContent = fs.readFileSync(resolvedPath, 'utf8');

  const { config: runtimeConfig, history } = pqutils.parseDataAndChatHistory(fileContent);
  const fullConfig = pqutils.resolveConfig(runtimeConfig, __dirname);

  const prompt = history.map(message => {
    return {
      role: message.name,
      content: message.content
    }
  })

  // Check for DeepSeek prefix completion
  const lastMessage = prompt.at(-1);
  if (lastMessage && lastMessage.role === 'assistant') {
    lastMessage.prefix = true;
  }

  if (attachment) {
    const resolvedAttachmentPath = path.resolve(attachment);
    const contents = fs.readFileSync(resolvedAttachmentPath, 'utf8');
    const attachmentPortion = `\nHere is the content of the attached file "${attachment}":\n\n<document>${contents}</document>`;
    prompt.at(-1).content += attachmentPortion;
  }

  const body = fullConfig.api_call_props;
  body.messages = prompt;

  fs.writeFileSync('_request.json', JSON.stringify(body, null, 2));

  const response = await fetch(fullConfig.api_url, {
    method: 'POST',
    headers: fullConfig.api_call_headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API request failed: ${response.status} - ${errorText}`);
  }

  const contentType = response.headers.get('content-type');
  const isStreaming = contentType && contentType.includes('text/event-stream');

  if (isStreaming) {
    let isFirstEvent = true;
    for await (const event of getStream(response)) {
      if (event.data === '[DONE]') {
        break;
      }

      const json = JSON.parse(event.data);
      if (fullConfig.pricing && json.usage) {
        errorStream.write(usageToCostString(fullConfig.pricing, json.usage));
      }

      let content = json.choices[0]?.delta?.content || '';
      if (content && isFirstEvent) {
        isFirstEvent = false;
        if (content[0] == "\n") {
          content = content.slice(1);
        }
      }
      if (content) {
        outputStream.write(content);
      }
    }
  } else {
    const json = await response.json();
    if (fullConfig.pricing && json.usage) {
      errorStream.write(usageToCostString(fullConfig.pricing, json.usage));
    }
    const content = json.choices?.[0]?.message?.content || '';
    outputStream.write(content);
  }
}

async function main() {
  commander.program.description('Send a prompt to an LLM.');
  commander.program.argument('<prompt_path>', 'Path to the prompt file.');
  commander.program.option('-a, --attachment <path>', 'Path to an attachment file.');
  commander.program.parse(process.argv);
  const [filePath] = commander.program.args;
  const options = commander.program.opts();

  await sendPrompt({ promptPath: filePath, attachment: options.attachment });
}

if (require.main === module) {
  main();
}

module.exports = { sendPrompt };
