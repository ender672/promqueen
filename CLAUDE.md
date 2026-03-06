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

### Pipeline Stages (`promqueen.js`)

```
precompletionlint → applyLorebook → applyTemplate → injectInstructions → formatNames → combineAdjacentMessages → sendPrompt → postCompletionLint
```

1. **precompletionlint** - Autocompletes partial speaker names, adds whitespace padding, and appends the next speaker's `@name` tag to prepare the file for the LLM response
2. **apply-lorebook** - Injects lorebook entries into messages based on keyword matches
3. **applytemplate** - Jinja2-like template substitution (`{{ var }}`, `{% include %}`)
4. **inject-instructions** - Resolves decorator tags into instruction text injected before decorated messages, and handles impersonation/prefill logic for the final character message
5. **formatnames** - Optionally prefixes message content with character names and, in combined group chat mode, sets all character messages to the `assistant` role
6. **combine-messages** - Combines adjacent messages with the same role into a single message
7. **sendprompt** - Sends request to LLM API and streams the results via SSE, escapes template/role syntax in output, tracks token costs
8. **postcompletionlint** - Adds whitespace padding and appends the next speaker's `@name` tag for the next user-entered message.

### Key Modules

- **`lib/pqutils.js`** - Config parsing with hierarchical resolution: defaults → `~/.promqueen` → CLI config → active profile → frontmatter
- **`sendprompt.js`** - LLM API communication with streaming (eventsource-parser) and cost calculation
- **`applytemplate.js`** - Template engine using rendertemplate for variable substitution
- **`lib/rendertemplate.js`** - Variable substitution and file inclusion with path traversal security checks
- **`lib/cardutils.js`** - Extracts character data from PNG AI character cards

### VS Code Extension (`vscode_extension/`)

Separate package with its own `node_modules`. Bundled via esbuild → `dist/extension.js`. Provides:
- Commands: Run Pipeline, Preview Prompt, Preview Template, Preview Lorebook, Preview HTML, Regenerate Last Message, Run Precompletion Lint, Cancel Pipeline
- `.pqueen` language support with TextMate grammar
- CompletionProvider for role names and decorators
- ImageHoverProvider for image previews

## Testing

Uses Node.js built-in test runner (`node:test` + `node:assert`). Tests are fixture-driven:
- Input files: `tests/fixtures/<feature>/*.input.pqueen`
- Expected outputs: `.request.json` (API request shape) or `.output.pqueen` (text output)
- Tests auto-discover fixtures via `fs.readdirSync` and generate test cases per file

To add a test case, create a new `.input.pqueen` file and its corresponding expectation file in the appropriate fixtures directory.

## Code Style

- Pure JavaScript (CommonJS `require`), no TypeScript in core
- ESLint 9 flat config with Node.js globals
- Async generators for streaming (`async function*`)
- Fail early and fail hard. We want exceptions, backtraces, and early exit when something unexpected happens. In cases where it doesn't prevent the application from exiting, allow this to happen.
- When checking data that comes into the application, add assertions to make sure our assumptions about the data is true. Throw exceptions and backtraces if they are not true.
- Don't abstract or extract shared functionality if it is simple. If it only saves a line or two, I would rather keep duplicated or repeated lines of code where they are used instead of moving them into a shared module or abstraction.
- When you do have to extract shared functionality in to a shared helper, keep the shared code focused and concise. This has the benefit of making the caller more readable, and offers greater flexibility if a slightly different use case arises later.
- The driving function of a piece of functionality should read like a recipe and be as flat/linear as possible.
