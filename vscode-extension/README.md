# Professional Dashboard — Code Learning Extension

VS Code companion for the Professional Dashboard Code Learning module. Connects to the running dashboard app via WebSocket and provides step context, file review, and step completion commands.

## Prerequisites

- Node.js ≥ 18
- `@vscode/vsce` (installed as a dev dependency)
- The Professional Dashboard app running locally

## Build and install locally

```bash
# From the repo root
cd vscode-extension

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Package as .vsix
npx vsce package
# → produces professional-dashboard-code-learning-0.1.0.vsix

# Install into VS Code
code --install-extension professional-dashboard-code-learning-0.1.0.vsix
```

Or as a single command from the repo root:

```bash
cd vscode-extension && npm install && npm run compile && npx vsce package && code --install-extension professional-dashboard-code-learning-0.1.0.vsix
```

## How it works

1. Activates automatically when VS Code opens a folder containing a `.professional-dashboard-project` marker file (created when you scaffold a project from the dashboard).
2. Reads `~/.professional-dashboard/ws-port` to find the WebSocket port the dashboard is listening on.
3. Connects and shows a status bar item: `$(mortar-board) Connected` / `Disconnected`.
4. Click the status bar item for quick commands (mark step complete, review file, open dashboard).

## Commands

| Command | Description |
|---|---|
| `Code Learning: Mark Step Complete` | Marks the active step done and advances to the next |
| `Code Learning: Review This File` | Sends the active editor file to the dashboard for LLM code review |
| `Code Learning: Open Dashboard` | Opens the Professional Dashboard app |

## Configuration

| Setting | Default | Description |
|---|---|---|
| `codeLearning.reviewOnSave` | `false` | Automatically send active file for review on every save. Disable if disruptive. |

## Uninstall

```bash
code --uninstall-extension local.professional-dashboard-code-learning
```
