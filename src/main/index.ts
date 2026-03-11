import { app, BrowserWindow, WebContentsView, shell, ipcMain, dialog, safeStorage, nativeTheme, nativeImage } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { IPC, type ResumeCompareWindowPayload } from '../shared/types'
import { openDatabase, closeDatabase } from './db'
import { runMigrations } from './db/schema'
import { registerSettingsHandlers, migrateSettings } from './ipc/settings'
import { registerLlmHandlers } from './ipc/llm'
import { registerPostHandlers } from './ipc/post'
import { registerPaperHandlers } from './ipc/papers'
import { registerJobHandlers } from './ipc/jobs'
import { registerTrackerHandlers } from './ipc/tracker'
import { registerSystemHandlers } from './ipc/system'
import { registerInterviewHandlers } from './ipc/interview'
import { registerCodeLearningHandlers } from './ipc/codeLearning'
import { wsServer } from './wsServer'

nativeTheme.themeSource = 'dark'

let mainWindow: BrowserWindow | null = null
let enrichmentWindow: BrowserWindow | null = null     // hidden window that hosts linkedinView for viewport
let linkedinView: WebContentsView | null = null       // silent enrichment view (inside enrichmentWindow)
let linkedinBrowserWindow: BrowserWindow | null = null // user-facing browser window
let linkedinChromeView: WebContentsView | null = null  // header chrome inside browser window
let linkedinContentView: WebContentsView | null = null // LinkedIn content inside browser window
let resumeCompareWindow: BrowserWindow | null = null
let resumeCompareWindowReady = false
let latestResumeComparePayload: ResumeCompareWindowPayload | null = null
let isQuitting = false
let captureLog: unknown[] = []   // accumulates captures during a tracking session
let manualEnrichJobId: number | null = null  // non-null when in manual enrich mode

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
.btn-capture { border-color:#0a66c2; color:#0a66c2; }
.btn-capture:hover { background:rgba(10,102,194,0.15); color:#3d8fd4; border-color:#3d8fd4; }
.btn-save { border-color:#22c55e; color:#22c55e; }
.btn-save:hover { background:rgba(34,197,94,0.15); color:#4ade80; border-color:#4ade80; }
</style>
</head>
<body>
  <span class="badge">LinkedIn</span>
  <div class="url-bar" id="url-bar">linkedin.com</div>
  <span class="hint" id="hint">Log in then close this panel</span>
  <button class="btn" onclick="doClose()">Done</button>
  <button class="btn btn-capture" id="btn-capture" style="display:none" onclick="doCapture()">⊙ Capture</button>
  <button class="btn btn-save" id="btn-save" style="display:none" onclick="doSave()">↓ Save Description</button>
  <button class="btn btn-x" title="Close (Esc)" onclick="doClose()">✕</button>
  <script>
    const { ipcRenderer } = require('electron');
    function doClose() { ipcRenderer.send('linkedin-browser:close'); }
    function doCapture() { ipcRenderer.send('linkedin-browser:capture'); }
    function doSave() { ipcRenderer.send('linkedin-browser:save-description'); }
    window.setUrl = function(u) {
      try {
        const parsed = new URL(u);
        document.getElementById('url-bar').textContent = parsed.hostname + parsed.pathname;
      } catch(e) {
        document.getElementById('url-bar').textContent = u;
      }
    };
    window.setTrackMode = function(on) {
      var btn = document.getElementById('btn-capture');
      btn.style.display = on ? '' : 'none';
      document.getElementById('hint').textContent = on
        ? 'Highlight a section, click Capture — repeat as needed, then Done'
        : 'Log in then close this panel';
      document.getElementById('hint').style.color = '';
    };
    window.showCaptureAck = function(n) {
      var hint = document.getElementById('hint');
      hint.textContent = '✓ Captured (' + n + ' total) — highlight next section or click Done';
      hint.style.color = '#4ade80';
      clearTimeout(window._ackTimer);
      window._ackTimer = setTimeout(function() {
        hint.textContent = 'Highlight a section, click Capture — repeat as needed, then Done';
        hint.style.color = '';
      }, 3000);
    };
    window.setManualEnrichMode = function(on) {
      document.getElementById('btn-capture').style.display = 'none';
      document.getElementById('btn-save').style.display = on ? '' : 'none';
      var hint = document.getElementById('hint');
      hint.textContent = on ? 'Highlight the job description text, then click Save Description' : 'Log in then close this panel';
      hint.style.color = on ? '#86efac' : '';
    };
    window.showSaveSuccess = function() {
      var hint = document.getElementById('hint');
      hint.textContent = '✓ Description saved!';
      hint.style.color = '#4ade80';
      document.getElementById('btn-save').style.display = 'none';
    };
    window.showSaveError = function(msg) {
      var hint = document.getElementById('hint');
      hint.textContent = '✗ ' + msg;
      hint.style.color = '#f87171';
      clearTimeout(window._saveErrTimer);
      window._saveErrTimer = setTimeout(function() {
        hint.textContent = 'Highlight the job description text, then click Save Description';
        hint.style.color = '#86efac';
      }, 3000);
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
  // Flush capture log to renderer (always — renderer ignores empty arrays)
  mainWindow?.webContents.send('linkedin:captureResult', captureLog)
  captureLog = []
  manualEnrichJobId = null

  if (linkedinBrowserWindow && !linkedinBrowserWindow.isDestroyed()) {
    linkedinBrowserWindow.hide()
  }
  if (linkedinChromeView && !linkedinChromeView.webContents.isDestroyed()) {
    linkedinChromeView.webContents
      .executeJavaScript('window.setTrackMode && window.setTrackMode(false); window.setManualEnrichMode && window.setManualEnrichMode(false)')
      .catch(() => {})
  }
  mainWindow?.focus()
}

function loadRendererWindow(targetWindow: BrowserWindow, query?: Record<string, string>): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const targetUrl = new URL(process.env['ELECTRON_RENDERER_URL'])
    if (query) {
      for (const [key, value] of Object.entries(query)) targetUrl.searchParams.set(key, value)
    }
    targetWindow.loadURL(targetUrl.toString())
    return
  }
  targetWindow.loadFile(join(__dirname, '../renderer/index.html'), query ? { query } : undefined)
}

function sendResumeCompareState(open: boolean): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(IPC.RESUME_COMPARE_WINDOW_STATE, { open })
}

function sendResumeComparePayloadToWindow(payload: ResumeCompareWindowPayload | null): void {
  if (!payload) return
  if (!resumeCompareWindow || resumeCompareWindow.isDestroyed() || !resumeCompareWindowReady) return
  resumeCompareWindow.webContents.send(IPC.RESUME_COMPARE_WINDOW_DATA, payload)
}

function closeResumeCompareWindow(): void {
  if (!resumeCompareWindow || resumeCompareWindow.isDestroyed()) {
    resumeCompareWindow = null
    resumeCompareWindowReady = false
    sendResumeCompareState(false)
    return
  }
  resumeCompareWindow.close()
}

function openResumeCompareWindow(payload: ResumeCompareWindowPayload): void {
  latestResumeComparePayload = payload

  if (resumeCompareWindow && !resumeCompareWindow.isDestroyed()) {
    resumeCompareWindow.show()
    resumeCompareWindow.focus()
    sendResumeCompareState(true)
    sendResumeComparePayloadToWindow(payload)
    return
  }

  const fallbackW = 760
  const fallbackH = 920
  const [mx, my] = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getPosition() : [120, 120]
  const [mw] = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getSize() : [1400, 900]

  resumeCompareWindowReady = false
  resumeCompareWindow = new BrowserWindow({
    x: mx + Math.max(24, mw - fallbackW - 24),
    y: my + 40,
    width: fallbackW,
    height: fallbackH,
    minWidth: 520,
    minHeight: 480,
    show: false,
    resizable: true,
    autoHideMenuBar: true,
    backgroundColor: '#1a1a1a',
    title: 'Resume Compare',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
    },
  })

  resumeCompareWindow.on('closed', () => {
    resumeCompareWindow = null
    resumeCompareWindowReady = false
    sendResumeCompareState(false)
  })

  resumeCompareWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  resumeCompareWindow.webContents.on('did-finish-load', () => {
    resumeCompareWindowReady = true
    sendResumeComparePayloadToWindow(latestResumeComparePayload)
  })

  resumeCompareWindow.once('ready-to-show', () => {
    resumeCompareWindow?.show()
    sendResumeCompareState(true)
    sendResumeComparePayloadToWindow(latestResumeComparePayload)
  })

  loadRendererWindow(resumeCompareWindow, { view: 'resume-compare' })
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

  loadRendererWindow(mainWindow)
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.dashboard.professional')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Initialize DB
  const db = openDatabase()
  runMigrations(db)
  migrateSettings()

  // Register all IPC handlers
  registerSettingsHandlers()
  registerLlmHandlers()
  registerPostHandlers()
  registerPaperHandlers()
  registerJobHandlers()
  registerTrackerHandlers()
  registerSystemHandlers()
  registerInterviewHandlers()
  registerCodeLearningHandlers()

  // Start WebSocket bridge for VS Code extension
  wsServer.start().catch(err => console.warn('[main] wsServer.start failed:', err))

  // Relay inbound WS messages → renderer
  wsServer.setMessageHandler((msg) => {
    mainWindow?.webContents.send('ws:message', msg)
  })

  // Renderer → WS broadcast
  ipcMain.on('ws:send', (_evt, msg) => {
    wsServer.broadcast(msg)
  })

  createWindow()

  // ── Resume Compare window IPC ────────────────────────────────────────────

  ipcMain.handle(IPC.RESUME_COMPARE_WINDOW_OPEN, (_evt, payload: ResumeCompareWindowPayload) => {
    openResumeCompareWindow(payload)
    return { open: true }
  })

  ipcMain.handle(IPC.RESUME_COMPARE_WINDOW_UPDATE, (_evt, payload: ResumeCompareWindowPayload) => {
    latestResumeComparePayload = payload
    if (resumeCompareWindow && !resumeCompareWindow.isDestroyed()) {
      sendResumeComparePayloadToWindow(payload)
      return { open: true }
    }
    return { open: false }
  })

  ipcMain.handle(IPC.RESUME_COMPARE_WINDOW_CLOSE, () => {
    closeResumeCompareWindow()
    return { open: false }
  })

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

  ipcMain.handle('linkedin:setTrackMode', (_evt, on: boolean) => {
    if (on) captureLog = []   // fresh log for each new tracking session
    if (linkedinChromeView && !linkedinChromeView.webContents.isDestroyed()) {
      linkedinChromeView.webContents
        .executeJavaScript(`window.setTrackMode && window.setTrackMode(${on})`)
        .catch(() => {})
    }
  })

  ipcMain.handle('linkedin:setManualEnrich', (_evt, jobId: number) => {
    manualEnrichJobId = jobId
    if (linkedinChromeView && !linkedinChromeView.webContents.isDestroyed()) {
      linkedinChromeView.webContents
        .executeJavaScript('window.setManualEnrichMode && window.setManualEnrichMode(true)')
        .catch(() => {})
    }
  })

  ipcMain.on('linkedin-browser:save-description', async () => {
    if (!linkedinContentView || linkedinContentView.webContents.isDestroyed()) return
    if (!manualEnrichJobId) return
    const jobId = manualEnrichJobId
    try {
      const result = await linkedinContentView.webContents.executeJavaScript(`
        (function() {
          const sel = window.getSelection()
          if (!sel || sel.rangeCount === 0) return { error: 'No text selected — highlight the job description first' }
          const text = sel.toString().trim()
          if (!text) return { error: 'No text selected — highlight the job description first' }
          const range = sel.getRangeAt(0)
          let el = range.commonAncestorContainer
          if (el.nodeType === 3) el = el.parentElement
          const chain = []
          let current = el
          while (current && current.tagName && current !== document.body && chain.length < 6) {
            const id = current.id ? '#' + current.id : ''
            const classes = [...current.classList].slice(0, 4).map(c => '.' + c).join('')
            const tag = current.tagName.toLowerCase()
            chain.unshift({ tag, id, classes, selector: tag + id + classes })
            current = current.parentElement
          }
          const selectors = chain.filter(n => n.id || n.classes).map(n => n.selector).reverse()
          return { text: text.slice(0, 20000), chain, selectors, url: location.href }
        })()
      `)
      if (result.error) {
        if (linkedinChromeView && !linkedinChromeView.webContents.isDestroyed()) {
          linkedinChromeView.webContents
            .executeJavaScript(`window.showSaveError && window.showSaveError(${JSON.stringify(result.error)})`)
            .catch(() => {})
        }
        return
      }
      // Show success in chrome, then hide after a moment
      if (linkedinChromeView && !linkedinChromeView.webContents.isDestroyed()) {
        linkedinChromeView.webContents
          .executeJavaScript('window.showSaveSuccess && window.showSaveSuccess()')
          .catch(() => {})
      }
      manualEnrichJobId = null
      mainWindow?.webContents.send('linkedin:manualEnrichResult', { jobId, ...result })
      setTimeout(() => hideLinkedInBrowserWindow(), 1500)
    } catch (err) {
      if (linkedinChromeView && !linkedinChromeView.webContents.isDestroyed()) {
        linkedinChromeView.webContents
          .executeJavaScript(`window.showSaveError && window.showSaveError(${JSON.stringify(String(err))})`)
          .catch(() => {})
      }
    }
  })

  ipcMain.on('linkedin-browser:capture', async () => {
    if (!linkedinContentView || linkedinContentView.webContents.isDestroyed()) return
    try {
      const entry = await linkedinContentView.webContents.executeJavaScript(`
        (function() {
          // ── Selection ────────────────────────────────────────────────────────
          const sel = window.getSelection()
          if (!sel || sel.rangeCount === 0) return { error: 'No text selected — highlight some text first' }
          const selectedText = sel.toString().trim()
          if (!selectedText) return { error: 'No text selected — highlight some text first' }
          const range = sel.getRangeAt(0)
          let el = range.commonAncestorContainer
          if (el.nodeType === 3) el = el.parentElement

          const chain = []
          let current = el
          while (current && current.tagName && current !== document.body && chain.length < 6) {
            const id = current.id ? '#' + current.id : ''
            const classes = [...current.classList].slice(0, 4).map(c => '.' + c).join('')
            const tag = current.tagName.toLowerCase()
            chain.unshift({
              tag, id, classes,
              selector: tag + id + classes,
              fullText: (current.innerText || '').slice(0, 80).replace(/\\n/g, ' ')
            })
            current = current.parentElement
          }

          const selectors = chain
            .filter(n => n.id || n.classes)
            .map(n => n.selector)
            .reverse()

          // ── Expand / show-more button scan ───────────────────────────────────
          const expandButtons = []
          const seen = new Set()
          // Text-match candidates
          const btns = document.querySelectorAll('button, a, [role="button"], span[tabindex]')
          for (let i = 0; i < btns.length; i++) {
            const b = btns[i]
            const txt = (b.innerText || '').trim()
            const lower = txt.toLowerCase()
            if (lower === 'show more' || lower === 'see more' || lower === 'show more description' ||
                txt === '…more' || txt === '...more' || /^[…\\.]{1,3}more$/i.test(txt)) {
              const id = b.id ? '#' + b.id : ''
              const cls = [...b.classList].slice(0, 4).map(c => '.' + c).join('')
              const sel2 = b.tagName.toLowerCase() + id + cls
              if (!seen.has(sel2)) { seen.add(sel2); expandButtons.push({ text: txt, selector: sel2, ariaLabel: b.getAttribute('aria-label') || '' }) }
            }
          }
          // aria-expanded=false candidates
          const ariaEls = document.querySelectorAll('[aria-expanded="false"]')
          for (let j = 0; j < ariaEls.length; j++) {
            const b = ariaEls[j]
            const label = (b.getAttribute('aria-label') || '').toLowerCase()
            if (/show|more|expand|description/i.test(label)) {
              const id = b.id ? '#' + b.id : ''
              const cls = [...b.classList].slice(0, 4).map(c => '.' + c).join('')
              const sel2 = b.tagName.toLowerCase() + id + cls
              if (!seen.has(sel2)) { seen.add(sel2); expandButtons.push({ text: (b.innerText || '').trim(), selector: sel2, ariaLabel: b.getAttribute('aria-label') || '' }) }
            }
          }

          return { selectedText: selectedText.slice(0, 300), chain, selectors, expandButtons, url: location.href }
        })()
      `)
      captureLog.push(entry)
      // Acknowledge in the chrome bar
      if (linkedinChromeView && !linkedinChromeView.webContents.isDestroyed()) {
        linkedinChromeView.webContents
          .executeJavaScript(`window.showCaptureAck && window.showCaptureAck(${captureLog.length})`)
          .catch(() => {})
      }
    } catch (err) {
      captureLog.push({ error: String(err) })
      if (linkedinChromeView && !linkedinChromeView.webContents.isDestroyed()) {
        linkedinChromeView.webContents
          .executeJavaScript(`window.showCaptureAck && window.showCaptureAck(${captureLog.length})`)
          .catch(() => {})
      }
    }
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
  wsServer.close()
  if (resumeCompareWindow && !resumeCompareWindow.isDestroyed()) resumeCompareWindow.destroy()
  if (enrichmentWindow && !enrichmentWindow.isDestroyed()) enrichmentWindow.destroy()
})
