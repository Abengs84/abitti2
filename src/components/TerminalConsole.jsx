import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

function toWsBase() {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.host}`
}

function TerminalConsole({
  sessionId,
  clientId,
  isAdminUnlocked,
  onStatusChange,
  onError,
}) {
  const containerRef = useRef(null)
  const terminalRef = useRef(null)
  const fitAddonRef = useRef(null)
  const socketRef = useRef(null)
  const intentionalCloseRef = useRef(false)

  useEffect(() => {
    if (!containerRef.current) return undefined
    const containerEl = containerRef.current
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'Consolas, Menlo, Monaco, monospace',
      fontSize: 13,
      scrollback: 2000,
      theme: {
        background: '#111827',
        foreground: '#e5e7eb',
      },
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(containerEl)
    fitAddon.fit()
    terminal.focus()
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    const focusOnPointerDown = () => terminal.focus()
    containerEl.addEventListener('mousedown', focusOnPointerDown)
    return () => {
      containerEl.removeEventListener('mousedown', focusOnPointerDown)
      try {
        terminal.dispose()
      } catch {
        // ignore
      }
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [])

  useEffect(() => {
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    if (!terminal || !fitAddon) return undefined
    if (!sessionId || !clientId || !isAdminUnlocked) {
      terminal.reset()
      terminal.writeln('Ingen aktiv terminalsession.')
      return undefined
    }

    terminal.reset()
    terminal.writeln('Ansluter till terminal...')

    const wsUrl = `${toWsBase()}/api/terminal/ws?sessionId=${encodeURIComponent(sessionId)}&clientId=${encodeURIComponent(clientId)}&admin=${encodeURIComponent(isAdminUnlocked ? 'true' : 'false')}`
    const ws = new WebSocket(wsUrl)
    socketRef.current = ws
    intentionalCloseRef.current = false

    ws.onopen = () => {
      onStatusChange?.('connected')
      fitAddon.fit()
      terminal.focus()
      ws.send(
        JSON.stringify({
          type: 'resize',
          cols: terminal.cols,
          rows: terminal.rows,
        }),
      )
    }

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data || '{}'))
        if (payload.type === 'output' && typeof payload.data === 'string') {
          terminal.write(payload.data)
          return
        }
        if (payload.type === 'ready') {
          terminal.writeln(`\r\nAnsluten till ${payload.host || 'okänd host'}.\r\n`)
          return
        }
        if (payload.type === 'exit') {
          terminal.writeln('\r\n[Session avslutad]\r\n')
          onStatusChange?.('closed')
          return
        }
        if (payload.type === 'closed') {
          terminal.writeln('\r\n[Session stängd]\r\n')
          onStatusChange?.('closed')
        }
      } catch {
        // Ignore malformed payload.
      }
    }

    ws.onerror = () => {
      if (!intentionalCloseRef.current) {
        onError?.('WebSocket-fel i terminalen.')
      }
    }

    ws.onclose = () => {
      onStatusChange?.('closed')
    }

    const disposableInput = terminal.onData((data) => {
      if (ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ type: 'input', data }))
    })

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      if (ws.readyState !== WebSocket.OPEN) return
      ws.send(
        JSON.stringify({
          type: 'resize',
          cols: terminal.cols,
          rows: terminal.rows,
        }),
      )
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      intentionalCloseRef.current = true
      disposableInput.dispose()
      resizeObserver.disconnect()
      try {
        ws.close()
      } catch {
        // ignore
      }
      socketRef.current = null
    }
  }, [sessionId, clientId, isAdminUnlocked, onStatusChange, onError])

  return <div ref={containerRef} className="terminal-console" />
}

export default TerminalConsole
