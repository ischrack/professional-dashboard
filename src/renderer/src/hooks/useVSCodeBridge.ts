import { useState, useEffect, useCallback, useRef } from 'react'
import type { VSCodeMessage } from '@shared/types'

// Extension sends a 'hello' and we track the timestamp. If we don't receive
// another message within HEARTBEAT_MS we consider the extension disconnected.
const HEARTBEAT_MS = 15_000

interface UseVSCodeBridgeReturn {
  connected: boolean
  lastMessage: VSCodeMessage | null
  sendToVSCode: (msg: VSCodeMessage) => void
}

export function useVSCodeBridge(): UseVSCodeBridgeReturn {
  const [connected, setConnected] = useState(false)
  const [lastMessage, setLastMessage] = useState<VSCodeMessage | null>(null)
  const heartbeatTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resetHeartbeat = useCallback(() => {
    if (heartbeatTimer.current) clearTimeout(heartbeatTimer.current)
    setConnected(true)
    heartbeatTimer.current = setTimeout(() => {
      setConnected(false)
    }, HEARTBEAT_MS)
  }, [])

  useEffect(() => {
    const cleanup = window.api.onWsMessage((msg: VSCodeMessage) => {
      setLastMessage(msg)
      // Any message from the extension counts as a heartbeat
      resetHeartbeat()
    })

    return () => {
      cleanup()
      if (heartbeatTimer.current) clearTimeout(heartbeatTimer.current)
    }
  }, [resetHeartbeat])

  const sendToVSCode = useCallback((msg: VSCodeMessage) => {
    window.api.wsSend(msg)
  }, [])

  return { connected, lastMessage, sendToVSCode }
}
