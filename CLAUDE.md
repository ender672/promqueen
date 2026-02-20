# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                    # Run all integration tests
npm run lint                # Run ESLint
node --test tests/integration/sendprompt.test.js  # Run a single test file
```

VS Code extension (run from `vscode_extension/`):
```bash
npm run build               # Bundle with esbuild (minified + sourcemaps)
npm run watch:esbuild       # Watch mode for development
```

## Architecture

PromQueen is an LLM prompt engineering pipeline with a VS Code extension. It processes `.pqueen` prompt files through a multi-stage pipeline.

### Prompt Format

Files use YAML frontmatter for config + `@role` markers for chat messages:
```
---
api_url: https://api.openai.com/v1/chat/completions
---
@system
You are a helpful assistant.

@user
Hello!
```

Character names use `@Character Name` (non-standard roles get mapped to `user`/`assistant` via `roleplay_user`). Decorators like `@Character Name [decorator]` inject special instructions.

### Pipeline Stages (`run_pipeline.js`)

```
precompletionlint → applytemplate → rptoprompt → sendprompt → postcompletionlint
```

1. **precompletionlint** - Auto-suggests next speaker, adds formatting padding
2. **applytemplate** - Jinja2-like template substitution (`{{ var }}`, `{% include %}`)
3. **rptoprompt** - Converts `@Character Name` chat format to `@system` / `@assistant` / `@user` format that more closely aligns with what will be sent to the API.
4. **sendprompt** - Sends request to LLM API and streams the results via SSE, tracks token costs
5. **postcompletionlint** - Cleans up response formatting, preparing the file for the next message.

### Key Modules

- **`lib/pqutils.js`** - Config parsing with hierarchical resolution: defaults → `~/.chathistory` → CLI config → active profile → frontmatter
- **`lib/sendprompt-core.js`** - LLM API communication with streaming (eventsource-parser) and cost calculation
- **`lib/applytemplate-core.js`** - Template engine with path traversal security checks
- **`lib/rendertemplate.js`** - Variable substitution and file inclusion
- **`lib/cardutils.js`** - Extracts character data from PNG AI character cards

### VS Code Extension (`vscode_extension/`)

Separate package with its own `node_modules`. Bundled via esbuild → `dist/extension.js`. Provides:
- Commands: Run Pipeline, Preview Prompt, Regenerate Last Message
- `.pqueen` language support with TextMate grammar
- CompletionProvider for role names and decorators
- ImageHoverProvider for image previews

## Testing

Uses Node.js built-in test runner (`node:test` + `node:assert`). Tests are fixture-driven:
- Input files: `tests/fixtures/<feature>/*.input.prompt`
- Expected outputs: `.request.json` (API request shape) or `.output.txt` (text output)
- Tests auto-discover fixtures via `fs.readdirSync` and generate test cases per file

To add a test case, create a new `.input.prompt` file and its corresponding expectation file in the appropriate fixtures directory.

## Code Style

- Pure JavaScript (CommonJS `require`), no TypeScript in core
- ESLint 9 flat config with Node.js globals
- Async generators for streaming (`async function*`)
- Fail early and fail hard. We want exceptions, backtraces, and early exit when something unexpected happens. In cases where it doesn't prevent the application from exiting, allow this to happen.
- When checking data that comes into the application, add assertions to make sure our assumptions about the data is true. Throw exceptions and backtraces if they are not true.
- Don't abstract or extract shared functionality if it is simple. If it only saves a line or two, I would rather keep duplicated or repeated lines of code where they are used instead of moving them into a shared module or abstraction.
- When you do have to extract shared functionality in to a shared helper, keep the shared code focused and concise. This has the benefit of making the caller more readable, and offers greater flexibility if a slightly different use case arises later.
- The driving function of a piece of functionality should read like a recipe and be as flat/linear as possible.
