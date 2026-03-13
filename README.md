# PromQueen

A prompt engineering tool for chatting with AI APIs. Write prompts as readable `.pqueen` text files, then run them interactively from the terminal. The underlying prompt format is designed to be human-friendly — plain text with minimal syntax that's easy to read and edit by hand.

Supports OpenAI, Anthropic, Google, DeepSeek, Mistral, Cohere, xAI, local llama.cpp, and any OpenAI-compatible API.

## Quick Start

Set at least one API key in your environment:

```
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
```

Point it at a character card PNG and start chatting:

```
npx pqueen character.png
```

Or at an existing `.pqueen` file:

```
npx pqueen chat.pqueen
```

## VS Code Extension

A VS Code extension with syntax highlighting and editor integration is included in `vscode_extension/`.
