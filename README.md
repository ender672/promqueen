# PromQueen

A prompt engineering tool for chatting with AI APIs. Write prompts as readable `.pqueen` text files, then run them interactively from the terminal. The underlying prompt format is designed to be human-friendly — plain text with minimal syntax that's easy to read and edit by hand.

Supports OpenAI, Anthropic, Google, DeepSeek, Mistral, Cohere, xAI, local llama.cpp, and any OpenAI-compatible API.

## Quick Start

Set at least one API key in your environment:

```
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
```

Point it at a character card PNG, a `.pqueen` file, a PNG URL, or a chub.ai character URL:

```
npx pqueen character.png
npx pqueen chat.pqueen
npx pqueen https://example.com/character.png
npx pqueen https://chub.ai/characters/author/character-name
```

## VS Code Extension

A VS Code extension with syntax highlighting and editor integration is included in `vscode_extension/`.
