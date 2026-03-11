# PromQueen

A prompt engineering tool for chatting with AI APIs. Write prompts as readable `.pqueen` text files, then run them interactively from the terminal. The underlying prompt format is designed to be human-friendly — plain text with minimal syntax that's easy to read and edit by hand.

Supports OpenAI, Anthropic, Google, DeepSeek, Mistral, Cohere, xAI, local llama.cpp, and any OpenAI-compatible API.

## Install

```
npm install
```

Set at least one API key in your environment, e.g.:

```
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
```

## Usage

```
./chat.mjs examples/simple_prompt.pqueen
```

You can set up roleplay scenarios with named characters:

```
./chat.mjs examples/creative_prompt.pqueen
```

## Character Cards

PromQueen can read character card PNG files. Point it at a `.png` card and it will extract the character definition automatically.

## VS Code Extension

A VS Code extension with syntax highlighting and editor integration is included in `vscode_extension/`.
