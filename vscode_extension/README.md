# PromQueen VS Code Extension

This extension integrates the PromQueen pipeline into Visual Studio Code, allowing you to run prompt generation and execution directly from your editor.

## Development & Testing (Recommended)

The easiest way to test changes or use the extension during development is using VS Code's **Run and Debug** feature.

1.  **Open the Repository**: Open the `vscode_extension` folder in VS Code (File > Open Folder...).
2.  **Install Dependencies**:
    Open a terminal in the `vscode_extension` directory and run:
    ```bash
    npm install
    ```
3.  **Run and Debug**:
    - Press `F5` (or click "Run and Debug" in the sidebar and select **Run Extension**).
    - This will open a new "Extension Development Host" window with the extension loaded.
    - Any changes you make to the source code can be applied by reloading the window (`Ctrl+R` / `Cmd+R` in the host window).
    - The build task is configured to run automatically before launch.

### Running Tests

To run the automated test suite for the entire project, including this extension, run the following command from the root of the `promqueen` repository:

```bash
node --test
```

## Manual Installation (VSIX)

If you want to install the extension permanently:

1.  **Install vsce**: `npm install -g @vscode/vsce`
2.  **Package**: Run `vsce package` inside the `vscode_extension` folder.
3.  **Install**: Run `code --install-extension promqueen-extension-0.0.1.vsix` or use the "Install from VSIX..." command in VS Code.

## Usage

1.  Open a `.pqueen` file (or rename a `.prompt` file to `.pqueen`).
    - You should see syntax highlighting for YAML frontmatter and `@role` headers.
2.  Run the pipeline:
    - Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
    - Run **PromQueen: Run Pipeline**.
3.  Regenerate response:
    - Run **PromQueen: Regenerate Last Message** to re-run only the last turn.

## Configuration

Prompts are configured via YAML frontmatter at the top of `.pqueen` files. See the [Frontmatter Settings Reference](../docs/frontmatter.md) for all available options.

## Features

-   **Pipeline Execution**: Runs the full PromQueen pipeline on the current file.
-   **Syntax Highlighting**: Supports `.pqueen` files with specific highlighting for roles and metadata.
-   **Streaming Output**: See the LLM response stream directly in your editor.
