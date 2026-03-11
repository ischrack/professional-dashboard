import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import WebSocket from 'ws'

// ── Types mirrored from shared/types.ts ──────────────────────────────────────
// (Copied here so the extension has no dependency on the Electron source tree)

type VSCodeMessage =
  | { type: 'hello'; projectId: string; folderPath: string }
  | { type: 'step_complete'; projectId: string; stepId: string; completionMethod: 'vscode' }
  | { type: 'file_contents'; projectId: string; stepId: string; filePath: string; content: string }
  | { type: 'goodbye'; projectId: string }
  | { type: 'ack'; activeStepId: string | null; targetFile: string | null }
  | { type: 'step_context'; stepId: string; targetFile: string | null; targetFunctionOrBlock: string | null }
  | { type: 'request_file'; stepId: string; filePath: string }

interface ActiveProject {
  id: string
  folderPath: string | null
  activeStepId: string | null
  targetFile: string | null
}

// ── Module-level state ────────────────────────────────────────────────────────

let ws: WebSocket | null = null
let statusBar: vscode.StatusBarItem | null = null
let activeProject: ActiveProject | null = null
let currentStepId: string | null = null
let currentTargetFile: string | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelay = 1000
let deactivated = false

// ── Helpers ───────────────────────────────────────────────────────────────────

function dashboardDir(): string {
  return path.join(os.homedir(), '.professional-dashboard')
}

function readJson<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function readPort(): number | null {
  try {
    const raw = fs.readFileSync(path.join(dashboardDir(), 'ws-port'), 'utf8').trim()
    const port = parseInt(raw, 10)
    return isNaN(port) ? null : port
  } catch {
    return null
  }
}

function workspaceFolderPath(): string | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null
}

function matchProject(): ActiveProject | null {
  const projects = readJson<ActiveProject[]>(
    path.join(dashboardDir(), 'active-projects.json')
  )
  if (!Array.isArray(projects)) return null
  const folderPath = workspaceFolderPath()
  if (!folderPath) return null
  return (
    projects.find(p => p.folderPath && folderPath.startsWith(p.folderPath)) ?? null
  )
}

// ── Status bar ────────────────────────────────────────────────────────────────

function ensureStatusBar(context: vscode.ExtensionContext): vscode.StatusBarItem {
  if (statusBar) return statusBar
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  statusBar.command = 'codeLearning._showMenu'
  context.subscriptions.push(statusBar)
  return statusBar
}

function updateStatusBar(connected: boolean): void {
  if (!statusBar) return
  if (connected) {
    statusBar.text = '$(mortar-board) Connected'
    statusBar.color = new vscode.ThemeColor('statusBarItem.prominentForeground')
    statusBar.tooltip = 'Code Learning — connected to dashboard'
  } else {
    statusBar.text = '$(mortar-board) Disconnected'
    statusBar.color = new vscode.ThemeColor('statusBarItem.warningForeground')
    statusBar.tooltip = 'Code Learning — dashboard not connected'
  }
  statusBar.show()
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

function send(msg: VSCodeMessage): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

function scheduleReconnect(): void {
  if (deactivated) return
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    const port = readPort()
    if (port) connect(port)
  }, reconnectDelay)
  reconnectDelay = Math.min(reconnectDelay * 2, 30_000)
}

function connect(port: number): void {
  if (deactivated) return
  try {
    ws = new WebSocket(`ws://localhost:${port}`)
  } catch {
    scheduleReconnect()
    return
  }

  ws.on('open', () => {
    reconnectDelay = 1000
    updateStatusBar(true)
    if (activeProject) {
      send({
        type: 'hello',
        projectId: activeProject.id,
        folderPath: workspaceFolderPath() ?? '',
      })
    }
  })

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString()) as VSCodeMessage
      handleInbound(msg)
    } catch {
      // ignore malformed messages
    }
  })

  ws.on('close', () => {
    ws = null
    updateStatusBar(false)
    scheduleReconnect()
  })

  ws.on('error', () => {
    // error always precedes close; let close handler schedule the reconnect
    ws = null
    updateStatusBar(false)
  })
}

// ── Inbound message handling ──────────────────────────────────────────────────

function handleInbound(msg: VSCodeMessage): void {
  switch (msg.type) {
    case 'ack': {
      currentStepId = msg.activeStepId
      currentTargetFile = msg.targetFile
      break
    }
    case 'step_context': {
      currentStepId = msg.stepId
      currentTargetFile = msg.targetFile
      if (msg.targetFile) {
        const fileName = path.basename(msg.targetFile)
        vscode.window
          .showInformationMessage(
            `Code Learning: next target file is ${fileName}`,
            'Open File'
          )
          .then(choice => {
            if (choice === 'Open File' && activeProject?.folderPath && msg.targetFile) {
              const fullPath = path.isAbsolute(msg.targetFile)
                ? msg.targetFile
                : path.join(activeProject.folderPath, msg.targetFile)
              vscode.workspace
                .openTextDocument(fullPath)
                .then(doc => vscode.window.showTextDocument(doc))
                .then(undefined, () => {/* file may not exist yet */})
            }
          })
      }
      break
    }
    case 'request_file': {
      // Dashboard is requesting file contents for review
      const filePath = activeProject?.folderPath && !path.isAbsolute(msg.filePath)
        ? path.join(activeProject.folderPath, msg.filePath)
        : msg.filePath
      fs.readFile(filePath, 'utf8', (err, content) => {
        if (err || !activeProject || !currentStepId) return
        send({
          type: 'file_contents',
          projectId: activeProject.id,
          stepId: currentStepId,
          filePath: msg.filePath,
          content,
        })
      })
      break
    }
    default:
      break
  }
}

// ── Commands ──────────────────────────────────────────────────────────────────

function cmdMarkStepComplete(): void {
  if (!activeProject || !currentStepId) {
    vscode.window.showWarningMessage('No active Code Learning step found.')
    return
  }
  send({
    type: 'step_complete',
    projectId: activeProject.id,
    stepId: currentStepId,
    completionMethod: 'vscode',
  })
  vscode.window.showInformationMessage('Step marked complete in dashboard.')
}

function cmdReviewThisFile(): void {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    vscode.window.showWarningMessage('Open a file to review.')
    return
  }
  if (!activeProject || !currentStepId) {
    vscode.window.showWarningMessage('No active Code Learning step found.')
    return
  }
  const filePath = vscode.workspace.asRelativePath(editor.document.uri)
  const content = editor.document.getText()
  send({
    type: 'file_contents',
    projectId: activeProject.id,
    stepId: currentStepId,
    filePath,
    content,
  })
  vscode.window.showInformationMessage('File sent for review. Check the dashboard.')
}

function cmdOpenDashboard(): void {
  vscode.env.openExternal(vscode.Uri.parse('professional-dashboard://focus'))
}

function showMenu(): void {
  vscode.window
    .showQuickPick(
      [
        { label: '✓ Mark Step Complete', id: 'mark' },
        { label: '◎ Review This File', id: 'review' },
        { label: '⧉ Open Dashboard', id: 'open' },
        { label: '✕ Disconnect', id: 'disconnect' },
      ],
      { placeHolder: 'Code Learning' }
    )
    .then(choice => {
      if (!choice) return
      switch (choice.id) {
        case 'mark':
          vscode.commands.executeCommand('codeLearning.markStepComplete')
          break
        case 'review':
          vscode.commands.executeCommand('codeLearning.reviewThisFile')
          break
        case 'open':
          vscode.commands.executeCommand('codeLearning.openDashboard')
          break
        case 'disconnect':
          ws?.close()
          ws = null
          updateStatusBar(false)
          break
      }
    })
}

// ── File watching ─────────────────────────────────────────────────────────────

function onDidSaveTextDocument(doc: vscode.TextDocument): void {
  const reviewOnSave = vscode.workspace
    .getConfiguration('codeLearning')
    .get<boolean>('reviewOnSave', false)
  if (!reviewOnSave) return
  if (!activeProject || !currentStepId) return
  const filePath = vscode.workspace.asRelativePath(doc.uri)
  send({
    type: 'file_contents',
    projectId: activeProject.id,
    stepId: currentStepId,
    filePath,
    content: doc.getText(),
  })
}

// ── Activation / deactivation ─────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  deactivated = false

  // Check if this workspace matches a known active project
  activeProject = matchProject()
  if (!activeProject) {
    // Register commands as no-ops with an informational message
    const noProject = (): void => {
      vscode.window.showInformationMessage(
        'No active Code Learning project found for this folder.'
      )
    }
    context.subscriptions.push(
      vscode.commands.registerCommand('codeLearning.markStepComplete', noProject),
      vscode.commands.registerCommand('codeLearning.reviewThisFile', noProject),
      vscode.commands.registerCommand('codeLearning.openDashboard', noProject),
      vscode.commands.registerCommand('codeLearning._showMenu', noProject)
    )
    return
  }

  // Seed step context from the project metadata
  currentStepId = activeProject.activeStepId
  currentTargetFile = activeProject.targetFile

  // Status bar
  ensureStatusBar(context)
  updateStatusBar(false)

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('codeLearning.markStepComplete', cmdMarkStepComplete),
    vscode.commands.registerCommand('codeLearning.reviewThisFile', cmdReviewThisFile),
    vscode.commands.registerCommand('codeLearning.openDashboard', cmdOpenDashboard),
    vscode.commands.registerCommand('codeLearning._showMenu', showMenu)
  )

  // File watchers
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(onDidSaveTextDocument)
  )

  // Connect to dashboard WebSocket
  const port = readPort()
  if (port) {
    connect(port)
  } else {
    updateStatusBar(false)
  }
}

export function deactivate(): void {
  deactivated = true
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (ws) {
    if (activeProject) {
      try {
        ws.send(JSON.stringify({ type: 'goodbye', projectId: activeProject.id }))
      } catch { /* ignore */ }
    }
    ws.close()
    ws = null
  }
}
