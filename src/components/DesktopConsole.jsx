import { useEffect, useRef } from 'react'
import RFB from '@novnc/novnc'

function toWsBase() {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const hostname = window.location.hostname
  const apiPort = Number(import.meta.env.VITE_API_PORT || import.meta.env.APP_API_PORT || 3010)
  return `${protocol}://${hostname}:${apiPort}`
}

function DesktopConsole({ host, enabled, isAdminUnlocked, password, onStatusChange, onError }) {
  const containerRef = useRef(null)
  const rfbRef = useRef(null)

  useEffect(() => {
    const containerEl = containerRef.current
    if (!containerEl) return undefined
    containerEl.innerHTML = ''
    if (!host || !isAdminUnlocked || !enabled) return undefined

    const wsUrl = `${toWsBase()}/api/desktop/ws?host=${encodeURIComponent(host)}&admin=${encodeURIComponent(
      isAdminUnlocked ? 'true' : 'false',
    )}`
    let rfb
    try {
      rfb = new RFB(containerEl, wsUrl, {
        credentials: password ? { password } : {},
      })
      rfb.scaleViewport = true
      rfb.resizeSession = false
      rfb.background = '#111827'
      rfb.addEventListener('connect', () => onStatusChange?.('connected'))
      rfb.addEventListener('disconnect', (event) => {
        onStatusChange?.('closed')
        if (!event.detail?.clean) {
          onError?.('Desktop-anslutningen avbröts.')
        }
      })
      rfb.addEventListener('credentialsrequired', () => {
        onError?.('VNC kräver lösenord. Fyll i lösenordsfältet och anslut igen.')
      })
      rfbRef.current = rfb
    } catch (error) {
      onStatusChange?.('error')
      onError?.(error.message || 'Kunde inte starta desktopsession.')
    }

    return () => {
      try {
        rfb?.disconnect()
      } catch {
        // ignore
      }
      rfbRef.current = null
    }
  }, [host, enabled, isAdminUnlocked, password, onStatusChange, onError])

  return <div ref={containerRef} className="desktop-console" />
}

export default DesktopConsole
