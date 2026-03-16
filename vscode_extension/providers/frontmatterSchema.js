const FRONTMATTER_SCHEMA = [
    {
        key: 'api_url',
        type: 'String (URL)',
        defaultValue: 'none (required)',
        description: 'The LLM API endpoint URL. Determines which send path is used: if the URL ends with `/v1/completions`, the raw completions path is used; otherwise the chat completions path is used.',
        example: 'api_url: https://api.openai.com/v1/chat/completions'
    },
    {
        key: 'api_call_headers',
        type: 'Object',
        defaultValue: '{}',
        description: 'HTTP headers included in the API request. Values support `$VAR` / `${VAR}` env var expansion.',
        example: 'api_call_headers:\n  Authorization: Bearer sk-...'
    },
    {
        key: 'api_call_props',
        type: 'Object',
        defaultValue: '{}',
        description: 'Additional properties merged into the JSON request body. Model selection, sampling parameters, and other API-specific options go here.',
        example: 'api_call_props:\n  model: gpt-4-turbo\n  temperature: 0.7'
    },
    {
        key: 'pricing',
        type: 'Object',
        defaultValue: 'none',
        description: 'Token pricing for cost calculation. Keys: `cost_uncached`, `cost_cached`, `cost_output` (dollars per million tokens).',
        example: 'pricing:\n  cost_uncached: 10\n  cost_cached: 5\n  cost_output: 20'
    },
    {
        key: 'debug_log_path',
        type: 'String (directory path)',
        defaultValue: 'none',
        description: 'Directory where the last API request payload is saved as `last_request_payload.json`.',
        example: 'debug_log_path: ./debug'
    },
    {
        key: 'chat_template_path',
        type: 'String (file path)',
        defaultValue: 'none',
        description: 'Path to a Jinja2 chat template file for formatting chat messages into a single prompt string. Only used with raw completions (`/v1/completions`).',
        example: 'chat_template_path: ./templates/llama3.jinja2'
    },
    {
        key: 'bos_token',
        type: 'String',
        defaultValue: "'<s>'",
        description: 'Beginning-of-sequence token passed to the chat template.',
        example: "bos_token: '<s>'"
    },
    {
        key: 'eos_token',
        type: 'String',
        defaultValue: "'</s>'",
        description: 'End-of-sequence token passed to the chat template.',
        example: "eos_token: '</s>'"
    },
    {
        key: 'roleplay_user',
        type: 'String',
        defaultValue: "'user'",
        description: 'The name of the user/player character. Mapped to the `user` role when converting roleplay format. Also used as the `{{user}}` template variable.',
        example: 'roleplay_user: Alice'
    },
    {
        key: 'roleplay_combined_group_chat',
        type: 'Boolean',
        defaultValue: 'false',
        description: 'Enables group chat mode. When true, all named character messages are prefixed with their name and sent as the `assistant` role.',
        example: 'roleplay_combined_group_chat: true'
    },
    {
        key: 'roleplay_impersonation_instruction',
        type: 'String',
        defaultValue: 'none',
        description: 'Template string injected as a `user` message when the LLM impersonates a character. Supports `{{char}}` and `{{user}}` variables.',
        example: "roleplay_impersonation_instruction: '[OOC: Write the next reply as {{char}}, responding to {{user}}.]'"
    },
    {
        key: 'roleplay_char_impersonation_instruction',
        type: 'Object',
        defaultValue: 'none',
        description: 'Per-character overrides for the impersonation instruction. Maps character names to instruction strings. Supports `{{char}}` and `{{user}}` variables.',
        example: "roleplay_char_impersonation_instruction:\n  Bob: '[OOC: Write as {{char}}, a grumpy wizard.]'"
    },
    {
        key: 'roleplay_prefix_with_name',
        type: 'Boolean',
        defaultValue: 'false',
        description: "When true and in impersonation mode, prefixes each named character's message content with their name.",
        example: 'roleplay_prefix_with_name: true'
    },
    {
        key: 'decorators',
        type: 'String (file path)',
        defaultValue: 'none',
        description: 'Path to a YAML file mapping decorator names to instruction text. Decorators are applied to character messages using `@Character [decorator]` syntax.',
        example: 'decorators: decorators.yaml'
    },
    {
        key: 'message_template_variables',
        type: 'Object',
        defaultValue: 'none',
        description: 'Custom variables for `{{ varname }}` substitution in message content. Overrides the built-in `char` and `user` variables.',
        example: 'message_template_variables:\n  setting: a dark forest'
    },
    {
        key: 'message_template_loader_path',
        type: 'String (directory path)',
        defaultValue: "prompt file's directory",
        description: "Base directory for resolving `{% include 'filename' %}` template paths. Also the security boundary for includes.",
        example: 'message_template_loader_path: /home/user/shared_templates'
    },
    {
        key: 'lorebook',
        type: 'String (file path)',
        defaultValue: 'none',
        description: 'Path to a JSON lorebook (character book) file. Scans message content for keyword matches and conditionally inserts lorebook entries. If omitted and a `charcard` PNG is set, the lorebook is auto-loaded from the charcard.',
        example: 'lorebook: character_book.json'
    },
    {
        key: 'dot_config_loading',
        type: 'Boolean',
        defaultValue: 'true',
        description: 'Whether to load `~/.promqueen` as a base config layer.',
        example: 'dot_config_loading: false'
    },
    {
        key: 'profile',
        type: 'String',
        defaultValue: 'none',
        description: 'Name of the active profile to select from `profiles`.',
        example: 'profile: creative'
    },
    {
        key: 'profiles',
        type: 'Object',
        defaultValue: 'none',
        description: 'Named configuration profiles. The profile selected by `profile` is merged into the resolved config between CLI config and frontmatter.',
        example: 'profiles:\n  creative:\n    api_call_props:\n      temperature: 0.9'
    }
];

const FRONTMATTER_SCHEMA_MAP = new Map(FRONTMATTER_SCHEMA.map(entry => [entry.key, entry]));

module.exports = { FRONTMATTER_SCHEMA, FRONTMATTER_SCHEMA_MAP };
