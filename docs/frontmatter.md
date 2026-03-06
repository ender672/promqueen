# Frontmatter Settings Reference

PromQueen `.pqueen` files use YAML frontmatter for configuration:

```
---
api_url: https://api.openai.com/v1/chat/completions
roleplay_user: Alice
---
@system
You are a helpful assistant.

@Alice
Hello!
```

## Configuration Resolution Order

Settings are merged in this order (later layers win):

1. **Built-in defaults** — hardcoded in `lib/pqutils.js`
2. **`~/.promqueen`** — user home directory config file (YAML)
3. **CLI config** — file passed via `-c`/`--config`
4. **Active profile** — settings from the profile selected by `profile`
5. **Frontmatter** — settings in the `.pqueen` file itself (highest priority)

## Configuration Management

### `dot_config_loading`

Whether to load `~/.promqueen` as a base config layer.

- **Type:** Boolean
- **Default:** `true`
- **Used by:** `lib/pqutils.js`

```yaml
dot_config_loading: false
```

### `profile`

Name of the active profile to select from `profiles`.

- **Type:** String
- **Default:** none
- **Used by:** `lib/pqutils.js`

```yaml
profile: creative
```

### `profiles`

Named configuration profiles. The profile selected by `profile` is merged into the resolved config (at priority level 4, between CLI config and frontmatter).

- **Type:** Object mapping profile names to config objects
- **Default:** none
- **Used by:** `lib/pqutils.js`

```yaml
profile: creative
profiles:
  creative:
    api_call_props:
      temperature: 0.9
  precise:
    api_call_props:
      temperature: 0.1
```

## API Settings

### `api_url`

The LLM API endpoint URL. Determines which send path is used: if the URL ends with `/v1/completions`, the raw completions path (`sendrawprompt.js`) is used. Otherwise, the chat completions path (`sendprompt.js`) is used.

- **Type:** String (URL)
- **Default:** none (required)
- **Used by:** `sendprompt.js`, `sendrawprompt.js`, `promqueen.js`

```yaml
api_url: https://api.openai.com/v1/chat/completions
```

### `api_call_headers`

HTTP headers included in the API request.

- **Type:** Object
- **Default:** `{}`
- **Used by:** `sendprompt.js`, `sendrawprompt.js`

```yaml
api_call_headers:
  Authorization: Bearer sk-...
  X-Custom-Header: value
```

### `api_call_props`

Additional properties merged into the JSON request body. This is where model selection, sampling parameters, and other API-specific options go.

- **Type:** Object
- **Default:** `{}`
- **Used by:** `sendprompt.js`, `sendrawprompt.js`

```yaml
api_call_props:
  model: gpt-4-turbo
  temperature: 0.7
  max_tokens: 2000
```

### `pricing`

Token pricing for cost calculation. When present and the API response includes usage data, a cost summary is logged to stderr.

- **Type:** Object with keys `cost_uncached`, `cost_cached`, `cost_output` (numeric, in dollars per million tokens)
- **Default:** none (cost logging disabled)
- **Used by:** `sendprompt.js`, `sendrawprompt.js`

```yaml
pricing:
  cost_uncached: 10
  cost_cached: 5
  cost_output: 20
```

### `debug_log_path`

Directory where the last API request payload is saved as `last_request_payload.json`. The directory is created if it doesn't exist.

- **Type:** String (directory path)
- **Default:** none (debug logging disabled)
- **Used by:** `sendprompt.js`, `sendrawprompt.js`

```yaml
debug_log_path: ./debug
```

## Raw Completions Settings

These settings only apply when `api_url` ends with `/v1/completions`, which routes through `sendrawprompt.js` instead of the chat completions path.

### `chat_template_path`

Path to a Jinja2 chat template file. The template is used to format the chat messages into a single prompt string for the completions endpoint.

- **Type:** String (file path)
- **Default:** none (required when using raw completions)
- **Used by:** `sendrawprompt.js`

```yaml
chat_template_path: ./templates/llama3.jinja2
```

### `bos_token`

Beginning-of-sequence token passed to the chat template.

- **Type:** String
- **Default:** `'<s>'`
- **Used by:** `sendrawprompt.js`

```yaml
bos_token: '<s>'
```

### `eos_token`

End-of-sequence token passed to the chat template.

- **Type:** String
- **Default:** `'</s>'`
- **Used by:** `sendrawprompt.js`

```yaml
eos_token: '</s>'
```

## Roleplay Settings

### `roleplay_user`

The name of the user/player character. This name is mapped to the `user` role when converting roleplay format to prompt format. It is also used for speaker guessing in the pre/post completion lint stages, and as the `{{user}}` template variable.

- **Type:** String
- **Default:** `'user'`
- **Used by:** `formatnames.js`, `precompletionlint.js`, `postcompletionlint.js`, `lib/rendertemplate.js`

```yaml
roleplay_user: Alice
```

### `roleplay_combined_group_chat`

Enables group chat mode. When true, all named character messages are prefixed with their name (uppercased) and sent as the `assistant` role. When false (the default), impersonation mode is used instead.

- **Type:** Boolean
- **Default:** `false`
- **Used by:** `formatnames.js`

```yaml
roleplay_combined_group_chat: true
```

### `roleplay_impersonation_instruction`

Template string injected as a `user` message when the LLM is asked to impersonate a character. Supports `{{char}}` (the character being impersonated) and `{{user}}` (the `roleplay_user` value).

- **Type:** String
- **Default:** none
- **Used by:** `formatnames.js`

```yaml
roleplay_impersonation_instruction: '[OOC: Write the next reply as {{char}}, responding to {{user}}.]'
```

### `roleplay_char_impersonation_instruction`

Per-character overrides for the impersonation instruction. When a character has an entry here, it takes priority over `roleplay_impersonation_instruction`. Supports the same `{{char}}` and `{{user}}` variables.

- **Type:** Object mapping character names to instruction strings
- **Default:** none
- **Used by:** `formatnames.js`

```yaml
roleplay_char_impersonation_instruction:
  Bob: '[OOC: Write as {{char}}, a grumpy wizard.]'
  Eve: '[OOC: Write as {{char}}, a cheerful rogue.]'
```

### `roleplay_prefix_with_name`

When true and in impersonation mode, prefixes each named character's message content with `NAME\n`. This gives the LLM visibility into who said what.

- **Type:** Boolean
- **Default:** none (treated as false)
- **Used by:** `formatnames.js`

```yaml
roleplay_prefix_with_name: true
```

### `decorators`

Path to a YAML file that maps decorator names to instruction text. Decorators are applied to character messages using bracket syntax: `@Character Name [decorator]`. When a decorator is found, its instruction text is injected into the prompt.

- **Type:** String (file path)
- **Default:** none
- **Used by:** `formatnames.js` (loaded via `lib/pqutils.js`)

```yaml
decorators: decorators.yaml
```

The decorator YAML file maps names to instruction strings:

```yaml
happy: 'The character is in a cheerful mood.'
whisper: 'The character speaks in a quiet whisper.'
```

Usage in the prompt:

```
@Bob [happy]
Hello there!
```

## Template Settings

### `message_template_variables`

Custom variables available for `{{ varname }}` substitution in message content during the `applytemplate` stage.

Values defined here override the built-in `char` and `user` variables.

- **Type:** Object mapping variable names to string values
- **Default:** none
- **Used by:** `applytemplate.js`, `lib/rendertemplate.js`

```yaml
message_template_variables:
  setting: a dark forest
  time_of_day: evening
```

**Built-in template variables** (set automatically by `buildTemplateContext` in `lib/rendertemplate.js`):
- `user` — the value of `roleplay_user`, unless overridden by `message_template_variables`
- `char` — auto-detected as the first speaker whose name isn't `system`, `user`, `assistant`, or the `roleplay_user` value. Can be overridden by `message_template_variables`.

### `message_template_loader_path`

Base directory for resolving `{% include 'filename' %}` paths in templates. Also serves as the security boundary — includes cannot traverse above this directory.

- **Type:** String (directory path)
- **Default:** the prompt file's directory
- **Used by:** `applytemplate.js`, `lib/rendertemplate.js`

```yaml
message_template_loader_path: /home/user/shared_templates
```

## Lorebook Settings

### `lorebook`

Path to a JSON lorebook (character book) file. When set, the `apply-lorebook` stage scans message content for keyword matches and conditionally inserts lorebook entries into the prompt.

- **Type:** String (file path)
- **Default:** none (lorebook stage is skipped)
- **Used by:** `apply-lorebook.js`, `promqueen.js`

```yaml
lorebook: character_book.json
```

The lorebook JSON contains an `entries` array and an optional `entry_template` string (defaults to `[OOC: {{content}}]`). Each entry supports:
- `keys` — primary keywords to match
- `secondary_keys` — secondary keywords (used with `selective: true`)
- `content` — the text to insert
- `enabled` — whether the entry is active
- `constant` — always insert regardless of keyword matches
- `selective` — require both primary and secondary key matches
- `case_sensitive` — case-sensitive keyword matching
- `use_regex` — interpret keys as regular expressions
- `insertion_order` — numeric ordering for entries inserted at the same position
