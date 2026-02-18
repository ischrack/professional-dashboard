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
let linkedinView: WebContentsView | null = null
let linkedinVisible = false
let isQuitting = false

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function getLinkedinView(): WebContentsView | null {
  return linkedinView
}

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

  // Create LinkedIn/embedded browser view (hidden by default)
  linkedinView = new WebContentsView({
    webPreferences: {
      partition: 'persist:linkedin',
      contextIsolation: true,
    },
  })

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

  // LinkedIn browser IPC
  ipcMain.handle('linkedin:showBrowser', (_evt, bounds) => {
    if (!mainWindow || !linkedinView) return
    if (!linkedinVisible) {
      mainWindow.contentView.addChildView(linkedinView)
      linkedinVisible = true
    }
    linkedinView.setBounds(bounds || { x: 0, y: 0, width: 400, height: 600 })
  })

  ipcMain.handle('linkedin:hideBrowser', () => {
    if (!mainWindow || !linkedinView || !linkedinVisible) return
    mainWindow.contentView.removeChildView(linkedinView)
    linkedinVisible = false
  })

  ipcMain.handle('linkedin:logout', () => {
    if (linkedinView) {
      linkedinView.webContents.session.clearStorageData()
      linkedinView.webContents.loadURL('https://www.linkedin.com/login')
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
})
