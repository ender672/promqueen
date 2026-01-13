# Installing the PromQueen VS Code Extension

This extension is designed to be run locally or side-loaded into VS Code.

## Prerequisites

- [Visual Studio Code](https://code.visualstudio.com/)
- [Node.js](https://nodejs.org/) (installed and available in your PATH)

## Method 1: Run in Development Mode (Recommended)

This is the easiest way to use the extension if you are also working on the PromQueen codebase.

1.  Open VS Code.
2.  Open the `promqueen` repository folder: `File > Open Folder...` -> Select `promqueen`.
3.  Go to the **Run and Debug** view in the Activity Bar (or press `Ctrl+Shift+D`).
4.  You may need to create a `launch.json` if one doesn't exist.
    - If needed, create `.vscode/launch.json` with the following content:
      ```json
      {
          "version": "0.2.0",
          "configurations": [
              {
                  "name": "Run Extension",
                  "type": "extensionHost",
                  "request": "launch",
                  "runtimeExecutable": "${execPath}",
                  "args": [
                      "--extensionDevelopmentPath=${workspaceFolder}/vscode_extension"
                  ],
                  "outFiles": [
                      "${workspaceFolder}/vscode_extension/dist/**/*.js"
                  ],
                  "preLaunchTask": "npm: build"
              }
          ]
      }
      ```
5.  Select **Run Extension** from the dropdown configuration list.
6.  Press `F5` or the green play button.
    - Note: This requires running `npm install` and `npm run build` in the `vscode_extension` directory first if the preLaunchTask is not configured.

## Method 2: Pack and Install VSIX (Side-loading)

If you want to install the extension permanently into your main VS Code instance:

1.  Install `vsce` (VS Code Extensions CLI) globally:
    ```bash
    npm install -g @vscode/vsce
    ```
2.  Navigate to the extension directory:
    ```bash
    cd vscode_extension
    ```
3.  Install dependencies:
    ```bash
    npm install
    ```
4.  Package the extension:
    ```bash
    vsce package
    ```
    This will automatically build and bundle the extension into a `.vsix` file (e.g., `promqueen-extension-0.0.1.vsix`).
5.  Install the VSIX in VS Code:
    - distinct command line: `code --install-extension promqueen-extension-0.0.1.vsix`
    - OR within VS Code:
        1.  Go to the **Extensions** view (`Ctrl+Shift+X`).
        2.  Click the `...` (Views and More Actions) menu at the top right of the Extensions pane.
        3.  Select **Install from VSIX...**
        4.  Choose the generated `.vsix` file.

## Usage

1.  Open a text file (e.g., a `.prompt` file or any text file you wish to process).
2.  Ensure you have your cursor in the editor.
3.  Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P` on macOS).
4.  Type and select **PromQueen: Run Pipeline**.
5.  The extension will run the pipeline steps (Pre-completion linting -> Template application -> Prompt generation -> Streaming response -> Post-completion linting) directly in your editor buffer.
