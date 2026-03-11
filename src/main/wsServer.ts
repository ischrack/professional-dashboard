import { WebSocketServer, WebSocket } from 'ws'
import { app } from 'electron'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { VSCodeMessage } from '../shared/types'

// Port range to try: 52049–52059
const PORT_START = 52049
const PORT_END = 52059

type MessageHandler = (msg: VSCodeMessage) => void

export class WsServer {
  private wss: WebSocketServer | null = null
  private port: number | null = null
  private clients = new Set<WebSocket>()
  private messageHandler: MessageHandler | null = null

  // ── Start ─────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    for (let port = PORT_START; port <= PORT_END; port++) {
      try {
        await this._tryBind(port)
        this.port = port
        this._writePortFile(port)
        console.log(`[WsServer] Listening on port ${port}`)
        return
      } catch {
        // port in use — try next
      }
    }
    console.warn('[WsServer] Could not bind to any port in range — VS Code bridge disabled')
  }

  private _tryBind(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port })
      wss.once('listening', () => {
        this.wss = wss
        wss.on('connection', (ws) => this._onConnect(ws))
        resolve()
      })
      wss.once('error', reject)
    })
  }

  // ── Port file ─────────────────────────────────────────────────────────────

  private _writePortFile(port: number): void {
    try {
      const dir = join(app.getPath('home'), '.professional-dashboard')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'ws-port'), String(port), 'utf8')
    } catch (err) {
      console.warn('[WsServer] Could not write port file:', err)
    }
  }

  // ── Active-projects file ──────────────────────────────────────────────────

  updateActiveProjects(projects: Array<{ id: string; folderPath: string | null; activeStepId: string | null; targetFile: string | null }>): void {
    try {
      const dir = join(app.getPath('home'), '.professional-dashboard')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'active-projects.json'), JSON.stringify(projects, null, 2), 'utf8')
    } catch (err) {
      console.warn('[WsServer] Could not write active-projects.json:', err)
    }
  }

  // ── Connection lifecycle ──────────────────────────────────────────────────

  private _onConnect(ws: WebSocket): void {
    this.clients.add(ws)
    console.log(`[WsServer] Client connected (total: ${this.clients.size})`)

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as VSCodeMessage
        this.messageHandler?.(msg)
      } catch (err) {
        console.warn('[WsServer] Failed to parse message:', err)
      }
    })

    ws.on('close', () => {
      this.clients.delete(ws)
      console.log(`[WsServer] Client disconnected (total: ${this.clients.size})`)
    })

    ws.on('error', (err) => {
      console.warn('[WsServer] Client error:', err.message)
      this.clients.delete(ws)
    })
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler
  }

  broadcast(msg: VSCodeMessage): void {
    if (this.clients.size === 0) return
    const payload = JSON.stringify(msg)
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload)
      }
    }
  }

  get connectedCount(): number {
    return this.clients.size
  }

  close(): void {
    for (const ws of this.clients) {
      try { ws.terminate() } catch { /* ignore */ }
    }
    this.clients.clear()
    this.wss?.close()
    this.wss = null
    console.log('[WsServer] Closed')
  }
}

export const wsServer = new WsServer()
