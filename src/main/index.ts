import { app, BrowserWindow, WebContentsView, shell, ipcMain, dialog, safeStorage, nativeTheme, nativeImage } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { openDatabase, closeDatabase } from './db'
import { runMigrations } from './db/schema'
import { registerSettingsHandlers } from './ipc/settings'
import { registerLlmHandlers } from './ipc/llm'
import { registerPostHandlers } from './ipc/post'
import { registerPaperHandlers } from './ipc/papers'
import { registerJobHandlers } from './ipc/jobs'
import { registerTrackerHandlers } from './ipc/tracker'
import { registerSystemHandlers } from './ipc/system'
import { registerInterviewHandlers } from './ipc/interview'

nativeTheme.themeSource = 'dark'

let mainWindow: BrowserWindow | null = null
let enrichmentWindow: BrowserWindow | null = null     // hidden window that hosts linkedinView for viewport
let linkedinView: WebContentsView | null = null       // silent enrichment view (inside enrichmentWindow)
let linkedinBrowserWindow: BrowserWindow | null = null // user-facing browser window
let linkedinChromeView: WebContentsView | null = null  // header chrome inside browser window
let linkedinContentView: WebContentsView | null = null // LinkedIn content inside browser window
let isQuitting = false

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function getLinkedinView(): WebContentsView | null {
  return linkedinView
}

// ── LinkedIn browser chrome HTML ─────────────────────────────────────────────
// Loaded in the chrome WebContentsView (nodeIntegration:true / contextIsolation:false)
// so require('electron') is available for IPC.

function getLinkedInChromeHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  background:#1c1c1c;
  border-bottom:1px solid #2a2a2a;
  height:100vh;
  display:flex;
  align-items:center;
  padding:0 14px;
  gap:10px;
  -webkit-app-region:drag;
  user-select:none;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
}
.badge {
  font-size:11px; font-weight:700; color:#0a66c2;
  letter-spacing:0.04em; flex-shrink:0;
}
.url-bar {
  flex:1; background:#111; border:1px solid #333; border-radius:5px;
  padding:4px 10px; font-size:11px; color:#666;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  -webkit-app-region:no-drag;
}
.hint { font-size:10px; color:#444; flex-shrink:0; -webkit-app-region:no-drag; }
.btn {
  background:none; border:1px solid #383838; border-radius:5px;
  cursor:pointer; font-size:11px; padding:5px 13px; color:#888;
  -webkit-app-region:no-drag; white-space:nowrap;
  transition:background 0.1s, color 0.1s;
}
.btn:hover { background:#2a2a2a; color:#ccc; border-color:#484848; }
.btn-x {
  border:none; font-size:15px; line-height:1;
  padding:4px 9px; color:#555;
}
.btn-x:hover { background:rgba(239,68,68,0.15); color:#f87171; }
</style>
</head>
<body>
  <span class="badge">LinkedIn</span>
  <div class="url-bar" id="url-bar">linkedin.com</div>
  <span class="hint">Log in then close this panel</span>
  <button class="btn" onclick="doClose()">Done</button>
  <button class="btn btn-x" title="Close (Esc)" onclick="doClose()">✕</button>
  <script>
    const { ipcRenderer } = require('electron');
    function doClose() { ipcRenderer.send('linkedin-browser:close'); }
    window.setUrl = function(u) {
      try {
        const parsed = new URL(u);
        document.getElementById('url-bar').textContent = parsed.hostname + parsed.pathname;
      } catch(e) {
        document.getElementById('url-bar').textContent = u;
      }
    };
  </script>
</body>
</html>`
}

// ── LinkedIn browser window lifecycle ────────────────────────────────────────

function showLinkedInBrowserWindow(): void {
  // Re-show if already created and not destroyed
  if (linkedinBrowserWindow && !linkedinBrowserWindow.isDestroyed()) {
    linkedinBrowserWindow.show()
    linkedinBrowserWindow.focus()
    return
  }

  if (!mainWindow) return

  // Center over mainWindow
  const [mx, my] = mainWindow.getPosition()
  const [mw, mh] = mainWindow.getSize()
  const bw = Math.max(900, Math.min(1100, mw - 80))
  const bh = Math.max(700, Math.min(800, mh - 80))
  const bx = mx + Math.floor((mw - bw) / 2)
  const by = my + Math.floor((mh - bh) / 2)

  linkedinBrowserWindow = new BrowserWindow({
    x: bx, y: by,
    width: bw, height: bh,
    minWidth: 900, minHeight: 700,
    show: false,
    frame: false,
    parent: mainWindow,
    modal: false,
    backgroundColor: '#1c1c1c',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // Chrome header view (our UI — needs nodeIntegration for ipcRenderer.send)
  linkedinChromeView = new WebContentsView({
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  // LinkedIn content view (shares persist:linkedin session with enrichment view)
  linkedinContentView = new WebContentsView({
    webPreferences: {
      partition: 'persist:linkedin',
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  linkedinBrowserWindow.contentView.addChildView(linkedinChromeView)
  linkedinBrowserWindow.contentView.addChildView(linkedinContentView)

  // Load chrome UI
  const chromeHtml = getLinkedInChromeHtml()
  linkedinChromeView.webContents.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(chromeHtml)}`
  )

  // Prevent chrome view from navigating away (security guard)
  linkedinChromeView.webContents.on('will-navigate', (event) => event.preventDefault())

  // Load LinkedIn
  linkedinContentView.webContents.loadURL('https://www.linkedin.com')

  // Position both views; called on every resize
  const CHROME_H = 48
  function updateBounds(): void {
    if (!linkedinBrowserWindow || linkedinBrowserWindow.isDestroyed()) return
    const [w, h] = linkedinBrowserWindow.getContentSize()
    linkedinChromeView!.setBounds({ x: 0, y: 0, width: w, height: CHROME_H })
    linkedinContentView!.setBounds({ x: 0, y: CHROME_H, width: w, height: h - CHROME_H })
  }
  linkedinBrowserWindow.on('resize', updateBounds)
  updateBounds()

  // Forward URL to chrome bar
  const pushUrl = (_e: Electron.Event, url: string): void => {
    linkedinChromeView?.webContents
      .executeJavaScript(`window.setUrl && window.setUrl(${JSON.stringify(url)})`)
      .catch(() => {})
  }
  linkedinContentView.webContents.on('did-navigate', pushUrl)
  linkedinContentView.webContents.on('did-navigate-in-page', pushUrl)

  // Escape key closes the panel from either view
  const onEscape = (_e: Electron.Event, input: Electron.Input): void => {
    if (input.type === 'keyDown' && input.key === 'Escape') hideLinkedInBrowserWindow()
  }
  linkedinChromeView.webContents.on('before-input-event', onEscape)
  linkedinContentView.webContents.on('before-input-event', onEscape)

  // Cleanup refs when the window is eventually destroyed
  linkedinBrowserWindow.on('closed', () => {
    linkedinBrowserWindow = null
    linkedinChromeView = null
    linkedinContentView = null
  })

  linkedinBrowserWindow.once('ready-to-show', () => linkedinBrowserWindow?.show())
}

function hideLinkedInBrowserWindow(): void {
  if (linkedinBrowserWindow && !linkedinBrowserWindow.isDestroyed()) {
    linkedinBrowserWindow.hide()
  }
  mainWindow?.focus()
}

// ── App window ───────────────────────────────────────────────────────────────

function createWindow(): void {
  // Resolve icon path — build/icon.icns in prod, build/icon.png in dev
  const iconPath = join(
    app.isPackaged ? process.resourcesPath : join(__dirname, '../../build'),
    process.platform === 'darwin' ? 'icon.icns' : 'icon.png'
  )

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#1a1a1a',
    icon: iconPath,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
    },
  })

  // macOS: set custom dock icon (especially visible in dev mode)
  if (process.platform === 'darwin') {
    const dockIcon = nativeImage.createFromPath(join(
      app.isPackaged ? process.resourcesPath : join(__dirname, '../../build'),
      'icon.png'
    ))
    if (!dockIcon.isEmpty()) app.dock?.setIcon(dockIcon)
  }

  // macOS: clicking the red X hides to dock; only Quit (Cmd+Q / menu) fully exits
  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin' && !isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Create a hidden BrowserWindow to host the enrichment view.
  // linkedinView MUST be inside a real window to get a CSS viewport — without one,
  // LinkedIn's IntersectionObserver never fires and #job-details never renders.
  enrichmentWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,          // never shown to user
    skipTaskbar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })

  linkedinView = new WebContentsView({
    webPreferences: {
      partition: 'persist:linkedin',
      contextIsolation: true,
    },
  })
  enrichmentWindow.contentView.addChildView(linkedinView)
  linkedinView.setBounds({ x: 0, y: 0, width: 1280, height: 900 })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.dashboard.professional')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Initialize DB
  const db = openDatabase()
  runMigrations(db)

  // Register all IPC handlers
  registerSettingsHandlers()
  registerLlmHandlers()
  registerPostHandlers()
  registerPaperHandlers()
  registerJobHandlers()
  registerTrackerHandlers()
  registerSystemHandlers()
  registerInterviewHandlers()

  createWindow()

  // ── LinkedIn browser IPC ──────────────────────────────────────────────────

  ipcMain.handle('linkedin:openUrl', (_evt, url: string) => {
    showLinkedInBrowserWindow()
    // Give the window a moment to appear before navigating
    setTimeout(() => {
      if (linkedinContentView && !linkedinContentView.webContents.isDestroyed()) {
        linkedinContentView.webContents.loadURL(url)
      }
    }, 300)
  })

  ipcMain.handle('linkedin:showBrowser', () => {
    showLinkedInBrowserWindow()
  })

  ipcMain.handle('linkedin:hideBrowser', () => {
    hideLinkedInBrowserWindow()
  })

  // Sent by the chrome view's close/done buttons (ipcRenderer.send, not invoke)
  ipcMain.on('linkedin-browser:close', () => {
    hideLinkedInBrowserWindow()
  })

  ipcMain.handle('linkedin:logout', () => {
    if (linkedinView) {
      linkedinView.webContents.session.clearStorageData()
      linkedinView.webContents.loadURL('https://www.linkedin.com/login')
    }
    if (linkedinContentView && !linkedinContentView.webContents.isDestroyed()) {
      linkedinContentView.webContents.session.clearStorageData()
      linkedinContentView.webContents.loadURL('https://www.linkedin.com/login')
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow?.show()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    closeDatabase()
    app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
  closeDatabase()
  if (enrichmentWindow && !enrichmentWindow.isDestroyed()) enrichmentWindow.destroy()
})
