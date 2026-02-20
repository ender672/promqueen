import globals from "globals";
import pluginJs from "@eslint/js";

export default [
    {
        ignores: ["vscode_extension/dist/"]
    },
    {
        languageOptions: {
            globals: {
                ...globals.node,
            }
        }
    },
    pluginJs.configs.recommended,
    {
        rules: {
            "no-unused-vars": ["error", { argsIgnorePattern: "^_" }]
        }
    },
];
