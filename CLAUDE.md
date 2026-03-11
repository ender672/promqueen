## Architecture

PromQueen is an LLM prompt engineering tool. It processes `.pqueen` prompt files to make LLM API calls. It has a VS Code extension in `vscode_extension/`, a one-shot runner in `pqueen-run.js` and an interactive CLI in `pqueen`.

### Prompt Format

YAML frontmatter for config + `@role` (or character name) markers for chat messages. Character names use `@Character Name` (non-standard roles get mapped to `user`/`assistant` via `roleplay_user`). Decorators like `@Character Name [decorator]` inject special instructions.

### .pqueen file processing stages

```
pre-completion-lint → apply-lorebook → apply-template → inject-instructions → format-names → combine-messages → send-prompt → post-completion-lint
```

## Testing / Linting

Uses Node.js built-in test runner (`node:test` + `node:assert`). Fixture-driven: `tests/fixtures/<feature>/*.input.pqueen` → `.request.json` or `.output.pqueen`, auto-discovered.

```bash
npm test
npm run lint
```

## Code Style

- Pure JavaScript (CommonJS `require`), no TypeScript in core
- Fail early and hard — exceptions, backtraces, early exit.
- Assert assumptions about incoming data; throw if violated.
- Prefer inline duplication over premature abstractions.
- Extracted helpers should be focused and concise.
- Driving functions should read like a flat, linear recipe.
