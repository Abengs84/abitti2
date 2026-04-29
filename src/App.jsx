import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TerminalConsole from './components/TerminalConsole'
import DesktopConsole from './components/DesktopConsole'

const LESSONS = [1, 2, 3, 4]
const WEEK_DAYS = [0, 1, 2, 3, 4]
const DAY_LABELS = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag']

const DEFAULT_SERVERS = [
  {
    id: 'srv-1',
    label: 'Server 1',
    name: 'vitsailu-neuvokas.koe.abitti.net',
    ip: '10.203.17.178',
    color: '#8d153a',
    info: 'Exempelserver enligt tidigare schema.',
    urlUpdatedAt: '',
    password: '',
    passwordOverride: false,
    passwordSource: '',
    passwordUpdatedAt: '',
    hiddenFromBooking: false,
  },
  {
    id: 'srv-2',
    label: 'Server 2',
    name: 'reipas-elmioi.koe.abitti.net',
    ip: '',
    color: '#dc2626',
    info: '',
    urlUpdatedAt: '',
    password: '',
    passwordOverride: false,
    passwordSource: '',
    passwordUpdatedAt: '',
    hiddenFromBooking: false,
  },
  {
    id: 'srv-3',
    label: 'Server 3',
    name: 'kuponan-torailua.koe.abitti.net',
    ip: '',
    color: '#ea580c',
    info: '',
    urlUpdatedAt: '',
    password: '',
    passwordOverride: false,
    passwordSource: '',
    passwordUpdatedAt: '',
    hiddenFromBooking: false,
  },
  {
    id: 'srv-4',
    label: 'Server 4',
    name: 'dyspeik-matinen.netti.koe.abitti.net',
    ip: '',
    color: '#0f766e',
    info: '',
    urlUpdatedAt: '',
    password: '',
    passwordOverride: false,
    passwordSource: '',
    passwordUpdatedAt: '',
    hiddenFromBooking: false,
  },
]

const DEFAULT_TEACHERS = [
  { id: 't-1', name: 'Lärare 1' },
  { id: 't-2', name: 'Lärare 2' },
]

const API_HEADERS = { 'Content-Type': 'application/json' }
const TERMINAL_CLIENT_STORAGE_KEY = 'abitti-terminal-client-id'

function randomServerColor() {
  const hue = Math.floor(Math.random() * 360)
  const saturation = 65 + Math.floor(Math.random() * 16)
  const lightness = 40 + Math.floor(Math.random() * 12)
  return hslToHex(hue, saturation, lightness)
}

function hslToHex(h, s, l) {
  const sat = s / 100
  const light = l / 100
  const c = (1 - Math.abs(2 * light - 1)) * sat
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = light - c / 2
  let r
  let g
  let b
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const toHex = (value) => {
    const hex = Math.round((value + m) * 255).toString(16)
    return hex.padStart(2, '0')
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function normalizeServerOrder(serverList) {
  return serverList.map((server, index) => ({
    ...server,
    sortOrder: index,
    hiddenFromBooking: Boolean(server.hiddenFromBooking),
  }))
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10)
}

function formatDateDisplay(dateInput) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput)
  if (Number.isNaN(date.getTime())) return ''
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}.${month}.${year}`
}

function formatDateWithWeekday(dateInput) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput)
  if (Number.isNaN(date.getTime())) return ''
  const weekday = new Intl.DateTimeFormat('sv-FI', { weekday: 'long' }).format(date)
  const capitalizedWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1)
  return `${capitalizedWeekday} ${formatDateDisplay(date)}`
}

function getOrCreateTerminalClientId() {
  const generateId = () => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
    return `term-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }
  try {
    const existing = globalThis.localStorage?.getItem(TERMINAL_CLIENT_STORAGE_KEY)
    if (existing) return existing
    const created = generateId()
    globalThis.localStorage?.setItem(TERMINAL_CLIENT_STORAGE_KEY, created)
    return created
  } catch {
    // Some browsers/private modes block localStorage; fall back to in-memory id.
    return generateId()
  }
}

function getMonday(date) {
  const d = new Date(date)
  const day = d.getDay() || 7
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - day + 1)
  return d
}

function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function getWeekDays(monday) {
  return WEEK_DAYS.map((offset) => addDays(monday, offset))
}

function getWeekLabel(monday) {
  const sunday = addDays(monday, 6)
  const format = new Intl.DateTimeFormat('sv-FI', { day: '2-digit', month: '2-digit' })
  const week = getIsoWeekNumber(monday)
  return `Vecka ${week} (${format.format(monday)} - ${format.format(sunday)})`
}

function getIsoWeekNumber(date) {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNumber = tmp.getUTCDay() || 7
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNumber)
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
  return Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7)
}

function isCellBooked(bookings, serverId, date, lesson) {
  return bookings.find(
    (booking) => booking.serverId === serverId && booking.date === date && booking.lesson === lesson,
  )
}

function toServerHref(serverName) {
  const value = (serverName || '').trim()
  if (!value) return '#'
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  return `https://${value}`
}

function toServerAuthHref(serverName, password, username = 'valvoja') {
  const baseHref = toServerHref(serverName)
  if (baseHref === '#') return '#'
  const cleanPassword = String(password || '').trim()
  if (!cleanPassword) return baseHref
  try {
    const url = new URL(baseHref)
    url.username = username
    url.password = cleanPassword
    return url.toString()
  } catch {
    return baseHref
  }
}

function shortenServerName(serverName, max = 16) {
  const value = (serverName || '').trim()
  const normalized = value.replace(/\.koe\.abitti\.net$/i, '')
  const cleaned = normalized.replace(/\.$/, '')
  if (cleaned.length <= max) return cleaned
  const sliced = cleaned.slice(0, max)
  return sliced.replace(/[.-]+$/, '')
}

function App() {
  const [view, setView] = useState('booking')
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(
    () => sessionStorage.getItem('abitti-admin-unlocked') === 'true',
  )
  const [isAdminLoginModalOpen, setIsAdminLoginModalOpen] = useState(false)
  const [adminPasswordInput, setAdminPasswordInput] = useState('')
  const [adminLoginError, setAdminLoginError] = useState('')
  const [weekStart, setWeekStart] = useState(getMonday(new Date()))
  const [servers, setServers] = useState(DEFAULT_SERVERS)
  const [teachers, setTeachers] = useState(DEFAULT_TEACHERS)
  const [bookings, setBookings] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isHydrated, setIsHydrated] = useState(false)
  const [adminServerForm, setAdminServerForm] = useState({
    label: '',
    name: '',
    ip: '',
    color: randomServerColor(),
    info: '',
  })
  const [adminTeacherForm, setAdminTeacherForm] = useState({ name: '' })
  const [isAddServerModalOpen, setIsAddServerModalOpen] = useState(false)
  const [isAddTeacherModalOpen, setIsAddTeacherModalOpen] = useState(false)
  const [isResolvingUrlByServerId, setIsResolvingUrlByServerId] = useState({})
  const [isResolvingPasswordByServerId, setIsResolvingPasswordByServerId] = useState({})
  const [isResolvingNewServerUrl, setIsResolvingNewServerUrl] = useState(false)
  const [lookupInfoByServerId, setLookupInfoByServerId] = useState({})
  const [newServerLookupInfo, setNewServerLookupInfo] = useState(null)
  const [serverStatusById, setServerStatusById] = useState({})
  const [isCheckingStatuses, setIsCheckingStatuses] = useState(false)
  const [versionInfoByServerId, setVersionInfoByServerId] = useState({})
  const [isLoadingVersions, setIsLoadingVersions] = useState(false)
  const [passwordInfoByServerId, setPasswordInfoByServerId] = useState({})
  const [isLoadingPasswords, setIsLoadingPasswords] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [bookingTeacherId, setBookingTeacherId] = useState('')
  const [bookingResponsible, setBookingResponsible] = useState(false)
  const [selectedCells, setSelectedCells] = useState([])
  const [dragAnchor, setDragAnchor] = useState(null)
  const [dragCurrent, setDragCurrent] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragMoved, setDragMoved] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
  const [bulkBookingModalOpen, setBulkBookingModalOpen] = useState(false)
  const [copiedPasswordServerId, setCopiedPasswordServerId] = useState('')
  const [requestedProtectedView, setRequestedProtectedView] = useState('admin')
  const [terminalSession, setTerminalSession] = useState(null)
  const [terminalStatus, setTerminalStatus] = useState('idle')
  const [terminalError, setTerminalError] = useState('')
  const [terminalServerId, setTerminalServerId] = useState('')
  const [isTerminalModalOpen, setIsTerminalModalOpen] = useState(false)
  const [isDesktopModalOpen, setIsDesktopModalOpen] = useState(false)
  const [desktopHost, setDesktopHost] = useState('')
  const [desktopStatus, setDesktopStatus] = useState('idle')
  const [desktopError, setDesktopError] = useState('')
  const [desktopPassword, setDesktopPassword] = useState('')
  const [desktopConnectRequested, setDesktopConnectRequested] = useState(false)
  const [copiedCodeId, setCopiedCodeId] = useState('')
  const terminalClientId = useMemo(() => getOrCreateTerminalClientId(), [])

  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart])
  const bookingLookup = useMemo(() => {
    const map = new Map()
    bookings.forEach((booking) => {
      map.set(`${booking.serverId}-${booking.date}-${booking.lesson}`, booking)
    })
    return map
  }, [bookings])
  const bookingServers = useMemo(
    () => servers.filter((server) => !server.hiddenFromBooking),
    [servers],
  )
  const terminalTargetServers = useMemo(
    () =>
      servers.filter((server) => {
        const hostValue = String(server.ip || server.name || '').trim()
        return Boolean(hostValue)
      }),
    [servers],
  )
  const effectiveTerminalServerId = terminalServerId || terminalTargetServers[0]?.id || ''
  const dragSelectionKeys =
    isDragging && dragAnchor && dragCurrent
      ? new Set(getCellsInRange(dragAnchor, dragCurrent).map((cell) => cell.key))
      : new Set()
  const selectedKeySet = useMemo(
    () => new Set(selectedCells.map((cell) => cell.key)),
    [selectedCells],
  )
  const selectedBookings = useMemo(
    () =>
      selectedCells
        .map((cell) => bookingLookup.get(cell.key))
        .filter(Boolean),
    [selectedCells, bookingLookup],
  )
  const selectedBookedCount = selectedBookings.length
  const selectedFreeCount = selectedCells.length - selectedBookedCount
  const currentWeekStartIso = useMemo(() => toIsoDate(getMonday(new Date())), [])
  const currentWeekEndIso = useMemo(
    () => toIsoDate(addDays(getMonday(new Date()), 6)),
    [],
  )
  const serverOrderById = useMemo(
    () => new Map(servers.map((server, index) => [server.id, index])),
    [servers],
  )
  const currentWeekBookings = useMemo(
    () =>
      bookings
        .filter((booking) => booking.date >= currentWeekStartIso && booking.date <= currentWeekEndIso)
        .sort((a, b) => {
          if (a.date !== b.date) return a.date.localeCompare(b.date)
          const serverOrderA = serverOrderById.get(a.serverId) ?? Number.MAX_SAFE_INTEGER
          const serverOrderB = serverOrderById.get(b.serverId) ?? Number.MAX_SAFE_INTEGER
          if (serverOrderA !== serverOrderB) return serverOrderA - serverOrderB
          return a.lesson - b.lesson
        }),
    [bookings, currentWeekStartIso, currentWeekEndIso, serverOrderById],
  )
  const terminalRequestHeaders = useMemo(
    () => ({
      ...API_HEADERS,
      'x-admin-unlocked': isAdminUnlocked ? 'true' : 'false',
      'x-terminal-client-id': terminalClientId,
    }),
    [isAdminUnlocked, terminalClientId],
  )
  const serversRef = useRef(servers)

  useEffect(() => {
    serversRef.current = servers
  }, [servers])

  async function loadState() {
    const response = await fetch('/api/state')
    if (!response.ok) throw new Error('Kunde inte läsa data från servern.')
    const data = await response.json()
    setServers(normalizeServerOrder(data.servers ?? []))
    setTeachers(data.teachers ?? [])
    setBookings(data.bookings ?? [])
  }

  useEffect(() => {
    let isMounted = true
    async function hydrate() {
      try {
        await loadState()
        if (isMounted) {
          setIsHydrated(true)
        }
      } catch {
        if (isMounted) {
          setErrorMessage('Kunde inte hämta data från databasen.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }
    hydrate()
    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!isTerminalModalOpen || !isAdminUnlocked) return undefined
    let cancelled = false
    async function fetchCurrentSession() {
      try {
        const response = await fetch('/api/terminal/session/current', {
          headers: {
            'x-admin-unlocked': 'true',
            'x-terminal-client-id': terminalClientId,
          },
        })
        if (!response.ok) return
        const payload = await response.json()
        if (cancelled) return
        setTerminalSession(payload.session || null)
        if (payload.session?.serverId) {
          setTerminalServerId(payload.session.serverId)
          setTerminalStatus('connected')
        }
      } catch {
        if (!cancelled) setTerminalError('Kunde inte läsa terminalsession.')
      }
    }
    fetchCurrentSession()
    return () => {
      cancelled = true
    }
  }, [isTerminalModalOpen, isAdminUnlocked, terminalClientId])

  useEffect(() => {
    function blockBrowserContextMenu(event) {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('.layout')) {
        event.preventDefault()
      }
    }
    window.addEventListener('contextmenu', blockBrowserContextMenu)
    return () => window.removeEventListener('contextmenu', blockBrowserContextMenu)
  }, [])

  useEffect(() => {
    if (!isHydrated) return undefined
    const timeoutId = setTimeout(async () => {
      try {
        await fetch('/api/meta', {
          method: 'PUT',
          headers: API_HEADERS,
          body: JSON.stringify({ servers, teachers }),
        })
      } catch {
        setErrorMessage('Kunde inte spara server/lärare till databasen.')
      }
    }, 350)
    return () => clearTimeout(timeoutId)
  }, [servers, teachers, isHydrated])

  function closeContextMenu() {
    setContextMenu(null)
  }

  function openProtectedView(targetView) {
    if (isAdminUnlocked) {
      setView(targetView)
      return
    }
    setRequestedProtectedView(targetView)
    setAdminPasswordInput('')
    setAdminLoginError('')
    setIsAdminLoginModalOpen(true)
  }

  function openAdminView() {
    openProtectedView('admin')
  }

  function submitAdminPassword(e) {
    e.preventDefault()
    if (adminPasswordInput === 'IKTadmin') {
      setIsAdminUnlocked(true)
      sessionStorage.setItem('abitti-admin-unlocked', 'true')
      setIsAdminLoginModalOpen(false)
      setAdminLoginError('')
      setView(requestedProtectedView)
      return
    }
    setAdminLoginError('Fel lösenord.')
  }

  async function connectTerminalSession(serverId = effectiveTerminalServerId) {
    if (!serverId) {
      setTerminalError('Välj en server först.')
      return
    }
    const selectedServer = servers.find((server) => server.id === serverId)
    if (!selectedServer) {
      setTerminalError('Vald server hittades inte.')
      return
    }
    setTerminalStatus('connecting')
    setTerminalError('')
    try {
      const response = await fetch('/api/terminal/session', {
        method: 'POST',
        headers: terminalRequestHeaders,
        body: JSON.stringify({
          serverId: selectedServer.id,
          host: selectedServer.ip || selectedServer.name || '',
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || 'Kunde inte starta terminalsession.')
      }
      setTerminalSession(payload)
      setTerminalServerId(serverId)
      setTerminalStatus('connected')
    } catch (err) {
      setTerminalStatus('error')
      setTerminalError(err.message || 'Terminalanslutning misslyckades.')
    }
  }

  async function disconnectTerminalSession() {
    if (!terminalSession?.sessionId && !terminalSession?.id) {
      setTerminalSession(null)
      setTerminalStatus('idle')
      return
    }
    const sessionId = terminalSession.sessionId || terminalSession.id
    try {
      await fetch(`/api/terminal/session/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers: {
          'x-admin-unlocked': isAdminUnlocked ? 'true' : 'false',
          'x-terminal-client-id': terminalClientId,
        },
      })
    } catch {
      // ignore and still clear local state
    }
    setTerminalSession(null)
    setTerminalStatus('idle')
  }

  function closeTerminalModal() {
    setIsTerminalModalOpen(false)
    disconnectTerminalSession()
  }

  async function openServerTerminal(serverId) {
    setTerminalServerId(serverId)
    setIsTerminalModalOpen(true)
    await connectTerminalSession(serverId)
  }

  async function openServerDesktop(server) {
    const host = String(server.ip || server.name || '').trim()
    if (!host) {
      setErrorMessage('Servern saknar IP/host för desktop.')
      return
    }
    setDesktopHost(host)
    setDesktopPassword('')
    setDesktopError('')
    setDesktopStatus('idle')
    setDesktopConnectRequested(false)
    setIsDesktopModalOpen(true)
    try {
      const response = await fetch(`/api/desktop/check?host=${encodeURIComponent(host)}`, {
        headers: {
          'x-admin-unlocked': isAdminUnlocked ? 'true' : 'false',
        },
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || 'Desktop-kontroll misslyckades.')
      }
      if (!payload.reachable) {
        setDesktopStatus('error')
        setDesktopError(
          'VNC-port 5900 svarar inte. Kontrollera att desktop sharing/VNC är aktiverat på Ubuntu-servern.',
        )
        return
      }
      setDesktopStatus('ready')
    } catch (err) {
      setDesktopStatus('error')
      setDesktopError(err.message || 'Desktop-kontroll misslyckades.')
    }
  }

  function closeDesktopModal() {
    setIsDesktopModalOpen(false)
    setDesktopConnectRequested(false)
    setDesktopStatus('idle')
    setDesktopError('')
  }

  async function copyCodeSnippet(snippetId, content) {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedCodeId(snippetId)
      setTimeout(() => {
        setCopiedCodeId((prev) => (prev === snippetId ? '' : prev))
      }, 1500)
    } catch {
      setErrorMessage('Kunde inte kopiera kommandot.')
    }
  }

  function connectDesktopSession() {
    if (!desktopHost) return
    setDesktopError('')
    setDesktopStatus('connecting')
    setDesktopConnectRequested(true)
  }

  function clearSelection() {
    setSelectedCells([])
    setDragAnchor(null)
    setDragCurrent(null)
    setIsDragging(false)
    setDragMoved(false)
  }

  async function removeBooking(bookingId) {
    try {
      const response = await fetch(`/api/bookings/${bookingId}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Delete failed')
      await loadState()
      setErrorMessage('')
    } catch {
      setErrorMessage('Kunde inte avboka i databasen.')
    }
  }

  async function removeSelectedBookings() {
    const bookingIds = Array.from(new Set(selectedBookings.map((booking) => booking.id)))
    if (!bookingIds.length) {
      setErrorMessage('Markeringen innehåller inga bokade celler.')
      return
    }
    try {
      const response = await fetch('/api/bookings/bulk-delete', {
        method: 'POST',
        headers: API_HEADERS,
        body: JSON.stringify({ bookingIds }),
      })

      if (response.status === 404) {
        for (const bookingId of bookingIds) {
          const deleteResponse = await fetch(`/api/bookings/${bookingId}`, {
            method: 'DELETE',
          })
          if (!deleteResponse.ok) {
            throw new Error('fallback delete failed')
          }
        }
      } else if (!response.ok) {
        throw new Error('bulk delete failed')
      }

      await loadState()
      clearSelection()
      closeContextMenu()
      setErrorMessage('')
    } catch {
      setErrorMessage('Kunde inte avboka markerade celler.')
    }
  }

  function updateServer(serverId, field, value) {
    setServers((prev) =>
      prev.map((server) =>
        server.id === serverId
          ? {
              ...server,
              [field]: value,
              ...(field === 'name' ? { urlUpdatedAt: new Date().toISOString() } : null),
              ...(field === 'password'
                ? {
                    passwordOverride: true,
                    passwordSource: 'manual',
                    passwordUpdatedAt: new Date().toISOString(),
                  }
                : null),
            }
          : server,
      ),
    )
  }

  async function resolveUrlFromIp(ip, hint = '') {
    const sshResponse = await fetch(`/api/resolve-url-ssh?ip=${encodeURIComponent(ip)}`)
    if (sshResponse.ok) {
      const sshPayload = await sshResponse.json()
      if (sshPayload?.url) {
        return sshPayload
      }
      if (sshPayload?.error) {
        throw new Error(sshPayload.error)
      }
    }

    const dnsResponse = await fetch(
      `/api/resolve-url?ip=${encodeURIComponent(ip)}&hint=${encodeURIComponent(hint)}`,
    )
    if (!dnsResponse.ok) {
      const payload = await dnsResponse.json().catch(() => ({}))
      throw new Error(payload.error || 'Kunde inte hitta URL.')
    }
    return dnsResponse.json()
  }

  async function searchServerUrl(serverId, ip) {
    const cleanIp = ip.trim()
    if (!cleanIp) {
      setErrorMessage('Fyll i IP-adress först.')
      return
    }
    setIsResolvingUrlByServerId((prev) => ({ ...prev, [serverId]: true }))
    try {
      const currentName = servers.find((server) => server.id === serverId)?.name || ''
      const result = await resolveUrlFromIp(cleanIp, currentName)
      setLookupInfoByServerId((prev) => ({
        ...prev,
        [serverId]: {
          vmIp: result.ip || cleanIp,
          source: result.source || 'okänd',
        },
      }))
      if (result.url) {
        updateServer(serverId, 'name', result.url)
        setErrorMessage('')
      } else {
        setErrorMessage('Ingen URL hittades för den här IP-adressen.')
      }
    } catch (err) {
      setErrorMessage(err.message)
    } finally {
      setIsResolvingUrlByServerId((prev) => ({ ...prev, [serverId]: false }))
    }
  }

  async function searchNewServerUrl() {
    const cleanIp = adminServerForm.ip.trim()
    if (!cleanIp) {
      setErrorMessage('Fyll i IP-adress först.')
      return
    }
    setIsResolvingNewServerUrl(true)
    try {
      const result = await resolveUrlFromIp(cleanIp, adminServerForm.name)
      setNewServerLookupInfo({
        vmIp: result.ip || cleanIp,
        source: result.source || 'okänd',
      })
      if (result.url) {
        setAdminServerForm((prev) => ({ ...prev, name: result.url }))
        setErrorMessage('')
      } else {
        setErrorMessage('Ingen URL hittades för den här IP-adressen.')
      }
    } catch (err) {
      setErrorMessage(err.message)
    } finally {
      setIsResolvingNewServerUrl(false)
    }
  }

  const refreshServerStatuses = useCallback(async (serversToCheck = []) => {
    if (!serversToCheck.length) return
    setIsCheckingStatuses(true)
    try {
      const response = await fetch('/api/server-status', {
        method: 'POST',
        headers: API_HEADERS,
        body: JSON.stringify({
          targets: serversToCheck.map((server) => ({
            id: server.id,
            ip: server.ip,
            name: server.name,
          })),
        }),
      })
      if (!response.ok) throw new Error('Kunde inte läsa serverstatus.')
      const payload = await response.json()
      const statusMap = {}
      for (const row of payload.results ?? []) {
        statusMap[row.id] = row
      }
      setServerStatusById(statusMap)
    } catch {
      // Keep previous status on transient errors.
    } finally {
      setIsCheckingStatuses(false)
    }
  }, [])

  const refreshServerVersions = useCallback(async (serversToCheck = []) => {
    if (!serversToCheck.length) return
    setIsLoadingVersions(true)
    try {
      const response = await fetch('/api/abitti-version-ssh-bulk', {
        method: 'POST',
        headers: API_HEADERS,
        body: JSON.stringify({
          targets: serversToCheck.map((server) => ({ id: server.id, ip: server.ip })),
        }),
      })
      if (!response.ok) throw new Error('Kunde inte läsa installerade versioner.')
      const payload = await response.json()
      const map = {}
      for (const row of payload.results ?? []) {
        map[row.id] = {
          version: row.version || '',
          host: row.host || '',
          error: row.error || '',
        }
      }
      setVersionInfoByServerId(map)
    } catch {
      // Keep previous version info on transient failures.
    } finally {
      setIsLoadingVersions(false)
    }
  }, [])

  const refreshServerPasswords = useCallback(async (serversToCheck = []) => {
    if (!serversToCheck.length) return
    setIsLoadingPasswords(true)
    try {
      const response = await fetch('/api/server-password-ssh-bulk', {
        method: 'POST',
        headers: API_HEADERS,
        body: JSON.stringify({
          targets: serversToCheck.map((server) => ({ id: server.id, ip: server.ip })),
        }),
      })
      if (!response.ok) throw new Error('Kunde inte läsa övervakarlösenord.')
      const payload = await response.json()
      const infoMap = {}
      const byId = new Map((payload.results ?? []).map((row) => [row.id, row]))
      setServers((prev) => {
        let changed = false
        const next = prev.map((server) => {
          const row = byId.get(server.id)
          if (!row) return server
          infoMap[server.id] = {
            seed: Array.isArray(row.seed) ? row.seed : [],
            source: row.source || 'naksu-password-seed',
            wordsCount: row.wordsCount || 0,
            naksuVersion: row.naksuVersion || '',
            host: row.host || '',
            error: row.error || '',
          }
          if (server.passwordOverride) {
            return server
          }
          const nextPassword = row.password || server.password || ''
          const nextSource = row.source || ''
          if (nextPassword === server.password && nextSource === server.passwordSource) {
            return server
          }
          changed = true
          return {
            ...server,
            password: nextPassword,
            passwordSource: nextSource,
            passwordUpdatedAt: row.password ? new Date().toISOString() : server.passwordUpdatedAt || '',
          }
        })
        return changed ? next : prev
      })
      setPasswordInfoByServerId(infoMap)
    } catch {
      // Keep previous info on transient failures.
    } finally {
      setIsLoadingPasswords(false)
    }
  }, [])

  async function searchServerPassword(serverId, ip) {
    const cleanIp = ip.trim()
    if (!cleanIp) {
      setErrorMessage('Fyll i IP-adress först.')
      return
    }
    setIsResolvingPasswordByServerId((prev) => ({ ...prev, [serverId]: true }))
    try {
      const response = await fetch('/api/server-password-ssh-bulk', {
        method: 'POST',
        headers: API_HEADERS,
        body: JSON.stringify({ targets: [{ id: serverId, ip: cleanIp }] }),
      })
      if (!response.ok) throw new Error('Kunde inte läsa övervakarlösenord.')
      const payload = await response.json()
      const row = payload.results?.[0]
      if (!row) throw new Error('Inget svar för servern.')
      setPasswordInfoByServerId((prev) => ({
        ...prev,
        [serverId]: {
          seed: Array.isArray(row.seed) ? row.seed : [],
          source: row.source || 'naksu-password-seed',
          wordsCount: row.wordsCount || 0,
          naksuVersion: row.naksuVersion || '',
          host: row.host || '',
          error: row.error || '',
        },
      }))
      setServers((prev) =>
        prev.map((server) => {
          if (server.id !== serverId) return server
          if (server.passwordOverride) return server
          return {
            ...server,
            password: row.password || server.password || '',
            passwordSource: row.source || '',
            passwordUpdatedAt: row.password ? new Date().toISOString() : server.passwordUpdatedAt || '',
          }
        }),
      )
      if (!row.error) {
        setErrorMessage('')
      }
    } catch (err) {
      setErrorMessage(err.message)
    } finally {
      setIsResolvingPasswordByServerId((prev) => ({ ...prev, [serverId]: false }))
    }
  }

  function addServer(e) {
    e.preventDefault()
    if (!adminServerForm.label || !adminServerForm.name) return
    setServers((prev) =>
      normalizeServerOrder([
        ...prev,
        {
          id: `srv-${crypto.randomUUID()}`,
          ...adminServerForm,
          sortOrder: prev.length,
          hiddenFromBooking: false,
          urlUpdatedAt: new Date().toISOString(),
        },
      ]),
    )
    setAdminServerForm({ label: '', name: '', ip: '', color: randomServerColor(), info: '' })
    setIsAddServerModalOpen(false)
  }

  function moveServer(serverId, direction) {
    setServers((prev) => {
      const index = prev.findIndex((server) => server.id === serverId)
      if (index < 0) return prev
      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(index, 1)
      next.splice(targetIndex, 0, moved)
      return normalizeServerOrder(next)
    })
  }

  function toggleServerVisibilityInBooking(serverId) {
    setServers((prev) =>
      prev.map((server) =>
        server.id === serverId
          ? { ...server, hiddenFromBooking: !server.hiddenFromBooking }
          : server,
      ),
    )
  }

  function getServerStatusState(serverId) {
    if (!serverStatusById[serverId]) return 'unknown'
    if (serverStatusById[serverId]?.state === 'ok') return 'ok'
    if (serverStatusById[serverId]?.state === 'warn') return 'warn'
    return 'down'
  }

  function getServerOverviewTitle(server) {
    const status = serverStatusById[server.id]
    const version = versionInfoByServerId[server.id]
    return [
      `${server.label || 'Okänd'}`,
      `URL: ${server.name || '-'}`,
      `IP: ${server.ip || '-'}`,
      `Status URL: ${status ? (status.urlReachable ? 'Ok' : 'Ner') : 'Okänd'}`,
      `Status IP: ${status ? (status.ipReachable ? 'Ok' : 'Ner') : 'Okänd'}`,
      `Version: ${version?.version || 'Okänd'}`,
      `Lösenord: ${server.password ? 'Finns' : 'Saknas'}`,
      `Info: ${server.info || '-'}`,
    ].join('\n')
  }

  function addTeacher(e) {
    e.preventDefault()
    if (!adminTeacherForm.name) return
    setTeachers((prev) => [...prev, { id: `t-${crypto.randomUUID()}`, ...adminTeacherForm }])
    setAdminTeacherForm({ name: '' })
    setIsAddTeacherModalOpen(false)
  }

  function removeTeacher(teacherId) {
    const hasBookings = bookings.some((booking) => booking.teacherId === teacherId)
    if (hasBookings) {
      setErrorMessage('Läraren kan inte tas bort eftersom den har bokningar.')
      return
    }
    setTeachers((prev) => prev.filter((teacher) => teacher.id !== teacherId))
    setErrorMessage('')
  }

  function removeServer(serverId) {
    const hasBookings = bookings.some((booking) => booking.serverId === serverId)
    if (hasBookings) {
      setErrorMessage('Servern kan inte tas bort eftersom den har bokningar.')
      return
    }
    setServers((prev) => prev.filter((server) => server.id !== serverId))
    setErrorMessage('')
  }

  function getCellKey(serverId, date, lesson) {
    return `${serverId}-${date}-${lesson}`
  }

  function getRowIndex(date, lesson) {
    const dayIndex = weekDays.findIndex((day) => toIsoDate(day) === date)
    return dayIndex * LESSONS.length + LESSONS.indexOf(lesson)
  }

  function getCellsInRange(startCell, endCell) {
    if (!startCell || !endCell) return []
    const startRow = getRowIndex(startCell.date, startCell.lesson)
    const endRow = getRowIndex(endCell.date, endCell.lesson)
    const startServerIndex = bookingServers.findIndex((server) => server.id === startCell.serverId)
    const endServerIndex = bookingServers.findIndex((server) => server.id === endCell.serverId)
    if (startRow < 0 || endRow < 0 || startServerIndex < 0 || endServerIndex < 0) return []

    const minRow = Math.min(startRow, endRow)
    const maxRow = Math.max(startRow, endRow)
    const minServer = Math.min(startServerIndex, endServerIndex)
    const maxServer = Math.max(startServerIndex, endServerIndex)
    const cells = []

    for (let row = minRow; row <= maxRow; row += 1) {
      const dayIndex = Math.floor(row / LESSONS.length)
      const lesson = LESSONS[row % LESSONS.length]
      const date = toIsoDate(weekDays[dayIndex])
      for (let serverIndex = minServer; serverIndex <= maxServer; serverIndex += 1) {
        const serverId = bookingServers[serverIndex].id
        cells.push({ serverId, date, lesson, key: getCellKey(serverId, date, lesson) })
      }
    }

    return cells
  }

  function toggleSingleCell(serverId, date, lesson) {
    const key = getCellKey(serverId, date, lesson)
    setSelectedCells((prev) => {
      const exists = prev.some((cell) => cell.key === key)
      if (exists) return prev.filter((cell) => cell.key !== key)
      return [...prev, { serverId, date, lesson, key }]
    })
    setErrorMessage('')
  }

  function addRangeToSelection(range) {
    if (!range.length) return
    setSelectedCells((prev) => {
      const map = new Map(prev.map((cell) => [cell.key, cell]))
      range.forEach((cell) => map.set(cell.key, cell))
      return Array.from(map.values())
    })
    setErrorMessage('')
  }

  function handleSlotMouseDown(serverId, date, lesson, event) {
    if (event.button !== 0) return
    event.preventDefault()
    const cell = { serverId, date, lesson }
    setDragAnchor(cell)
    setDragCurrent(cell)
    setIsDragging(true)
    setDragMoved(false)
  }

  function handleSlotMouseEnter(serverId, date, lesson) {
    if (!isDragging) return
    const next = { serverId, date, lesson }
    const hasMoved =
      !dragCurrent ||
      dragCurrent.serverId !== serverId ||
      dragCurrent.date !== date ||
      dragCurrent.lesson !== lesson
    if (hasMoved) {
      setDragMoved(true)
      setDragCurrent(next)
    }
  }

  function finishDragSelection() {
    if (!isDragging || !dragAnchor || !dragCurrent) return
    if (dragMoved) {
      addRangeToSelection(getCellsInRange(dragAnchor, dragCurrent))
    } else {
      const singleCell = {
        serverId: dragAnchor.serverId,
        date: dragAnchor.date,
        lesson: dragAnchor.lesson,
        key: getCellKey(dragAnchor.serverId, dragAnchor.date, dragAnchor.lesson),
      }
      setSelectedCells([singleCell])
      const singleCellBooking = bookingLookup.get(singleCell.key)
      if (!singleCellBooking) {
        if (!bookingTeacherId && teachers[0]?.id) {
          setBookingTeacherId(teachers[0].id)
        }
        setBookingResponsible(false)
        setBulkBookingModalOpen(true)
      }
      closeContextMenu()
      setErrorMessage('')
    }
    setIsDragging(false)
    setDragAnchor(null)
    setDragCurrent(null)
    setDragMoved(false)
  }

  async function saveSelectedCells() {
    if (!selectedCells.length) {
      setErrorMessage('Markera minst en cell.')
      return
    }
    if (!bookingTeacherId) {
      setErrorMessage('Välj en lärare.')
      return
    }

    const cellsToBook = selectedCells.filter(
      (cell) => !bookingLookup.get(cell.key),
    )
    if (!cellsToBook.length) {
      setErrorMessage('Markeringen innehåller inga lediga celler.')
      return
    }

    const conflicts = cellsToBook.filter((cell) =>
      isCellBooked(bookings, cell.serverId, cell.date, cell.lesson),
    )
    if (conflicts.length > 0) {
      setErrorMessage('En del markerade celler hann bokas av annan data. Markera igen.')
      return
    }

    try {
      const response = await fetch('/api/bookings/bulk', {
        method: 'POST',
        headers: API_HEADERS,
        body: JSON.stringify({
          teacherId: bookingTeacherId,
          responsible: bookingResponsible,
          cells: cellsToBook,
        }),
      })

      if (!response.ok) {
        if (response.status === 409) {
          setErrorMessage('En eller flera markerade tider är redan bokade.')
          await loadState()
          return
        }
        throw new Error('save failed')
      }

      await loadState()
      clearSelection()
      closeContextMenu()
      setBulkBookingModalOpen(false)
      setErrorMessage('')
    } catch {
      setErrorMessage('Kunde inte spara bokning i databasen.')
    }
  }

  async function copyServerPassword(server) {
    const value = String(server.password || '').trim()
    if (!value) {
      setErrorMessage('Inget lösenord att kopiera för den här servern.')
      return
    }
    try {
      await navigator.clipboard.writeText(value)
      setCopiedPasswordServerId(server.id)
      setErrorMessage('')
      setTimeout(() => {
        setCopiedPasswordServerId((prev) => (prev === server.id ? '' : prev))
      }, 1600)
    } catch {
      setErrorMessage('Kunde inte kopiera lösenordet.')
    }
  }

  function handleCellContextMenu(event, serverId, date, lesson, isBooked) {
    event.preventDefault()
    const bookingForCell = bookingLookup.get(getCellKey(serverId, date, lesson))

    const key = getCellKey(serverId, date, lesson)
    let selectionToUse = selectedCells

    if (!isBooked && !selectedKeySet.has(key)) {
      selectionToUse = [{ serverId, date, lesson, key }]
      setSelectedCells(selectionToUse)
    }

    const selectedBookingsForMenu = selectionToUse
      .map((cell) => bookingLookup.get(cell.key))
      .filter(Boolean)
    const selectedBookedCountForMenu = selectedBookingsForMenu.length
    const selectedFreeCountForMenu = selectionToUse.length - selectedBookedCountForMenu
    const canBook = selectedFreeCountForMenu > 0
    const canUnbook = selectedBookedCountForMenu > 0
    if (!canBook && !canUnbook) return

    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      canBook,
      canUnbook,
      unbookBookingId: bookingForCell?.id ?? null,
      hasMultipleBooked: selectedBookedCountForMenu > 1,
    })
  }

  useEffect(() => {
    if (!contextMenu) return undefined
    function handleGlobalClick() {
      closeContextMenu()
    }
    window.addEventListener('click', handleGlobalClick)
    window.addEventListener('scroll', handleGlobalClick, true)
    return () => {
      window.removeEventListener('click', handleGlobalClick)
      window.removeEventListener('scroll', handleGlobalClick, true)
    }
  }, [contextMenu])

  useEffect(() => {
    function handleLeftClickOutside(event) {
      if (event.button !== 0) return
      const target = event.target
      if (!(target instanceof Element)) return

      if (
        target.closest('.table-wrap') ||
        target.closest('.context-menu') ||
        target.closest('.modal')
      ) {
        return
      }

      clearSelection()
      closeContextMenu()
    }

    window.addEventListener('mousedown', handleLeftClickOutside)
    return () => window.removeEventListener('mousedown', handleLeftClickOutside)
  }, [])

  useEffect(() => {
    if (view !== 'admin') return undefined
    const runStatus = () => refreshServerStatuses(serversRef.current)
    const runVersions = () => refreshServerVersions(serversRef.current)
    const runPasswords = () => refreshServerPasswords(serversRef.current)
    const initialTimer = setTimeout(() => {
      runStatus()
      runVersions()
      runPasswords()
    }, 0)
    const timer = setInterval(runStatus, 30000)
    const versionTimer = setInterval(runVersions, 60000)
    const passwordTimer = setInterval(runPasswords, 60000)
    return () => {
      clearTimeout(initialTimer)
      clearInterval(timer)
      clearInterval(versionTimer)
      clearInterval(passwordTimer)
    }
  }, [view, refreshServerStatuses, refreshServerVersions, refreshServerPasswords])

  return (
    <div className="layout" onContextMenu={(event) => event.preventDefault()}>
      <header className="topbar">
        <div>
          <h1>Bokningslista för Abitti2</h1>
          <p>Bokning och information</p>
        </div>
        <div className="topbar-actions">
          <button type="button" onClick={() => setView('booking')} className={view === 'booking' ? 'active' : ''}>
            Bokning
          </button>
          <button type="button" onClick={openAdminView} className={view === 'admin' ? 'active' : ''}>
            Administrering
          </button>
        </div>
      </header>

      {view === 'booking' ? (
        <section className="panel" onContextMenu={(event) => event.preventDefault()}>
          <div className="week-controls">
            <button type="button" onClick={() => setWeekStart((prev) => addDays(prev, -7))}>
              Föregående vecka
            </button>
            <strong>{getWeekLabel(weekStart)}</strong>
            <button type="button" onClick={() => setWeekStart((prev) => addDays(prev, 7))}>
              Nästa vecka
            </button>
          </div>
          <p className="selection-hint">
            Markera med vänster musknapp (klicka eller dra). Högerklicka på markeringen och välj Boka eller Avboka.
          </p>
          {isLoading ? <p className="selection-hint">Laddar data från databasen...</p> : null}
          {errorMessage ? <p className="error">{errorMessage}</p> : null}

          <div
            className="table-wrap"
            onMouseUp={finishDragSelection}
            onContextMenu={(event) => event.preventDefault()}
          >
            <table>
              <thead>
                <tr>
                  <th>Dag</th>
                  <th>Lektion</th>
                  {bookingServers.map((server) => (
                    <th key={server.id}>
                      <div className="server-title">
                        <span>{server.label}</span>
                        <small className="server-link-row">
                          <a
                            className="server-name-link"
                            href={toServerHref(server.name)}
                            target="_blank"
                            rel="noreferrer"
                            title={server.name}
                          >
                            {shortenServerName(server.name)}
                          </a>
                          <a
                            className={`password-link-btn ${server.password ? '' : 'disabled'}`.trim()}
                            href={toServerAuthHref(server.name, server.password)}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="Öppna som valvoja"
                            title="Öppna med färdig autentisering"
                            onClick={(event) => {
                              if (!server.password) event.preventDefault()
                            }}
                          >
                            ↗
                          </a>
                        </small>
                        <div className="server-password-chip">
                          <strong title={server.password || 'Lösenord saknas'}>
                            {server.password || 'Lösenord saknas'}
                          </strong>
                          <button
                            type="button"
                            onClick={() => copyServerPassword(server)}
                            disabled={!server.password}
                            aria-label="Kopiera lösenord"
                            title={copiedPasswordServerId === server.id ? 'Kopierat' : 'Kopiera lösenord'}
                          >
                            ⧉
                          </button>
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weekDays.map((date, dayIndex) =>
                  LESSONS.map((lesson, lessonIndex) => {
                    const dateIso = toIsoDate(date)
                    return (
                      <tr key={`${dateIso}-${lesson}`} className={lessonIndex === 0 ? 'day-start-row' : ''}>
                        {lessonIndex === 0 ? (
                          <td rowSpan={LESSONS.length}>
                            {DAY_LABELS[dayIndex]}
                            <br />
                            <small>{formatDateDisplay(date)}</small>
                          </td>
                        ) : null}
                        <td>{lesson}</td>
                        {bookingServers.map((server) => {
                          const booking = bookingLookup.get(`${server.id}-${dateIso}-${lesson}`)
                          const cellKey = getCellKey(server.id, dateIso, lesson)
                          const isSelected =
                            selectedCells.some((cell) => cell.key === cellKey) ||
                            dragSelectionKeys.has(cellKey)
                          return (
                            <td key={server.id} className={isSelected ? 'selected-cell' : ''}>
                              <button
                                type="button"
                                className="slot selection-active"
                                style={{ '--server-color': server.color }}
                                onMouseDown={(event) =>
                                  handleSlotMouseDown(server.id, dateIso, lesson, event)
                                }
                                onMouseEnter={() =>
                                  handleSlotMouseEnter(server.id, dateIso, lesson)
                                }
                                onMouseUp={finishDragSelection}
                                onContextMenu={(event) =>
                                  handleCellContextMenu(event, server.id, dateIso, lesson, Boolean(booking))
                                }
                                onKeyDown={(event) => {
                                  if ((event.key === 'Enter' || event.key === ' ') && !booking) {
                                    event.preventDefault()
                                    toggleSingleCell(server.id, dateIso, lesson)
                                  }
                                }}
                              >
                                {booking ? (
                                  <>
                                    <strong className={booking.responsible ? 'responsible-name' : ''}>
                                      {teachers.find((teacher) => teacher.id === booking.teacherId)?.name ?? 'Lärare'}
                                    </strong>
                                    {booking.responsible ? <span>Serveransvarig</span> : <span>Reserverad</span>}
                                  </>
                                ) : (
                                  <span>Ledig</span>
                                )}
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  }),
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="panel admin-grid">
          <article className="card servers-card">
            <div className="card-header">
              <h2>Servrar</h2>
              <div className="card-header-actions">
                <span className="status-check-text">
                  {isCheckingStatuses || isLoadingPasswords
                    ? 'Uppdaterar status och lösenord...'
                    : 'Status och lösenord uppdaterade'}
                </span>
                <button type="button" onClick={() => refreshServerStatuses(servers)}>
                  Uppdatera status
                </button>
                <button type="button" className="add-server-btn" onClick={() => setIsAddServerModalOpen(true)}>
                  Lägg till
                  <br />
                  server
                </button>
              </div>
            </div>
            <div className="server-status-overview">
              {servers.map((server, index) => (
                <div key={`overview-${server.id}`} className="server-status-row">
                  <span
                    className={`status-dot compact ${getServerStatusState(server.id)}`}
                    title={getServerOverviewTitle(server)}
                  />
                  <span>{`S${index + 1}`}</span>
                </div>
              ))}
            </div>
            {servers.map((server) => (
              <div key={server.id} className="admin-item">
                <div className="name-field">
                  <label className="field-group field-display-name">
                    <span>Visningsnamn</span>
                    <input
                      value={server.label}
                      onChange={(e) => updateServer(server.id, 'label', e.target.value)}
                      placeholder="Visningsnamn"
                    />
                  </label>
                  <span
                    className={`status-dot ${getServerStatusState(server.id)}`}
                    title={
                      serverStatusById[server.id]
                        ? `URL: ${serverStatusById[server.id].urlReachable ? 'Ok' : 'Ner'}\nIP: ${serverStatusById[server.id].ipReachable ? 'Ok' : 'Ner'}`
                        : 'Ingen status ännu'
                    }
                  />
                </div>
                <div className="server-action-buttons">
                  <button
                    type="button"
                    onClick={() => moveServer(server.id, 'up')}
                    disabled={servers[0]?.id === server.id}
                    title="Flytta upp"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveServer(server.id, 'down')}
                    disabled={servers[servers.length - 1]?.id === server.id}
                    title="Flytta ner"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => searchServerUrl(server.id, server.ip)}
                    disabled={Boolean(isResolvingUrlByServerId[server.id])}
                  >
                    {isResolvingUrlByServerId[server.id] ? 'Söker...' : 'Sök URL'}
                  </button>
                  <button
                    type="button"
                    onClick={() => searchServerPassword(server.id, server.ip)}
                    disabled={Boolean(isResolvingPasswordByServerId[server.id])}
                  >
                    {isResolvingPasswordByServerId[server.id] ? 'Söker...' : 'Sök lösenord'}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeServer(server.id)}
                    disabled={bookings.some((booking) => booking.serverId === server.id)}
                  >
                    Ta bort server
                  </button>
                  <button
                    type="button"
                    onClick={() => openServerTerminal(server.id)}
                    title="Öppna terminal för servern"
                  >
                    Terminal
                  </button>
                  <button
                    type="button"
                    onClick={() => openServerDesktop(server)}
                    title="Öppna desktop i webbläsaren"
                  >
                    Desktop
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleServerVisibilityInBooking(server.id)}
                    title="Visa eller göm på bokningssidan"
                  >
                    {server.hiddenFromBooking ? 'Visa i bokning' : 'Göm i bokning'}
                  </button>
                </div>
                <label className="readonly-field">
                  Installerad Abitti2-version
                  <input
                    className="field-version"
                    value={
                      isLoadingVersions && !versionInfoByServerId[server.id]
                        ? 'Läser version...'
                        : versionInfoByServerId[server.id]?.version || 'Okänd'
                    }
                    readOnly
                  />
                </label>
                {versionInfoByServerId[server.id]?.error ? (
                  <small className="error">Versionskontroll: {versionInfoByServerId[server.id].error}</small>
                ) : null}
                <label className="readonly-field">
                  URL/Servernamn
                  <input
                    className="field-url"
                    value={server.name}
                    onChange={(e) => updateServer(server.id, 'name', e.target.value)}
                    placeholder="URL/Servernamn"
                    title={
                      lookupInfoByServerId[server.id]
                        ? `URL-källa: ${lookupInfoByServerId[server.id].source}${
                            lookupInfoByServerId[server.id].source === 'hint-verify'
                              ? ' (namn-hint verifierad mot IP)'
                              : ''
                          }`
                        : 'Ingen URL-källa ännu'
                    }
                  />
                </label>
                <label className="readonly-field">
                  Övervakarlösenord
                  <input
                    className="field-password"
                    value={server.password || ''}
                    onChange={(e) => updateServer(server.id, 'password', e.target.value)}
                    placeholder="Lösenord (valvoja)"
                    title={
                      passwordInfoByServerId[server.id]
                        ? `Lösenordskälla: ${server.passwordSource || passwordInfoByServerId[server.id].source || 'okänd'}${
                            passwordInfoByServerId[server.id].naksuVersion
                              ? `, Naksu2 ${passwordInfoByServerId[server.id].naksuVersion}`
                              : ''
                          }${
                            passwordInfoByServerId[server.id].seed?.length
                              ? `, seed: ${passwordInfoByServerId[server.id].seed.join(',')}`
                              : ''
                          }${server.passwordOverride ? ' (manuell override aktiv)' : ''}`
                        : 'Ingen lösenordskälla ännu'
                    }
                  />
                </label>
                <label className="responsible compact">
                  <input
                    type="checkbox"
                    checked={Boolean(server.passwordOverride)}
                    onChange={(e) =>
                      setServers((prev) =>
                        prev.map((item) =>
                          item.id === server.id
                            ? {
                                ...item,
                                passwordOverride: e.target.checked,
                                ...(e.target.checked
                                  ? { passwordSource: 'manual' }
                                  : {
                                      passwordSource:
                                        item.passwordSource === 'manual'
                                          ? ''
                                          : item.passwordSource,
                                    }),
                              }
                            : item,
                        ),
                      )
                    }
                  />
                  Manuell override
                </label>
                <label className="readonly-field">
                  IP-adress
                  <input
                    className="field-ip"
                    value={server.ip}
                    onChange={(e) => updateServer(server.id, 'ip', e.target.value)}
                    placeholder="IP-adress"
                    title={
                      lookupInfoByServerId[server.id]
                        ? `VM IP: ${lookupInfoByServerId[server.id].vmIp} (källa: ${lookupInfoByServerId[server.id].source})`
                        : 'Ingen VM-IP info ännu'
                    }
                  />
                </label>
                {passwordInfoByServerId[server.id]?.error ? (
                  <small className="error">Lösenordsuppslag: {passwordInfoByServerId[server.id].error}</small>
                ) : null}
                <input type="color" value={server.color} onChange={(e) => updateServer(server.id, 'color', e.target.value)} aria-label="Serverfärg" />
                <textarea value={server.info} onChange={(e) => updateServer(server.id, 'info', e.target.value)} placeholder="Information" rows={2} />
                <small>
                  URL uppdaterad: {server.urlUpdatedAt ? new Date(server.urlUpdatedAt).toLocaleString('sv-FI') : 'Ingen tid registrerad'}
                </small>
              </div>
            ))}
          </article>

          <article className="card teachers-card">
            <div className="card-header">
              <h2>Lärare</h2>
              <button type="button" onClick={() => setIsAddTeacherModalOpen(true)}>
                Lägg till lärare
              </button>
            </div>
            {teachers.map((teacher) => (
              <div key={teacher.id} className="teacher-row">
                <input value={teacher.name} onChange={(e) => setTeachers((prev) => prev.map((t) => (t.id === teacher.id ? { ...t, name: e.target.value } : t)))} />
                <button
                  type="button"
                  onClick={() => removeTeacher(teacher.id)}
                  disabled={bookings.some((booking) => booking.teacherId === teacher.id)}
                >
                  Ta bort lärare
                </button>
              </div>
            ))}
          </article>

          <article className="card system-card">
            <h2>Systeminformation</h2>
            <p>Ingen autentisering är aktiverad. All data sparas i gemensam databas på servern/datorn där detta program körs.</p>
            
            <p>När server matas in behövs endast IP och en etikett. URL och lösenord kan hämtas med knapparna.</p>
            <p>Uppdatera serverns URL i serverlistan när Abitti2 byter adress.</p>
            <p>Övervakarlösenord hämtas från serverns <code>passwordSeed</code> och räknas ut med Naksu2:s ordlista.
              Aktivera <code>Manuell override</code> om ni behöver skriva in ett eget lösenord efter framtida Naksu2-ändringar.
            </p>
            <details className="info-expand">
              <summary>VNC</summary>
              <p>
                För browser-desktop i Abitti2 behöver Ubuntu-servern ha VNC på port 5900. Rekommenderad väg är x11vnc.
              </p>
              <ol className="info-steps">
                <li>
                  <span className="step-title">
                    <strong>Logga in mot Ubuntu-server med Terminal</strong> (från Abitti2-värddatorn):
                  </span>
                  <div className="copyable-code">
                    <button
                      type="button"
                      onClick={() => copyCodeSnippet('vnc-login', 'ssh -i .\\keys\\abitti2 school@10.203.X.X')}
                      aria-label="Kopiera kommando"
                      title={copiedCodeId === 'vnc-login' ? 'Kopierat' : 'Kopiera'}
                    >
                      {copiedCodeId === 'vnc-login' ? '✓' : '⧉'}
                    </button>
                    <pre><code>ssh -i .\keys\abitti2 school@10.203.X.X</code></pre>
                  </div>
                </li>
                <li>
                  <span className="step-title">
                    <strong>Installera x11vnc:</strong>
                  </span>
                  <div className="copyable-code">
                    <button
                      type="button"
                      onClick={() => copyCodeSnippet('vnc-install', 'sudo apt update && sudo apt install -y x11vnc')}
                      aria-label="Kopiera kommando"
                      title={copiedCodeId === 'vnc-install' ? 'Kopierat' : 'Kopiera'}
                    >
                      {copiedCodeId === 'vnc-install' ? '✓' : '⧉'}
                    </button>
                    <pre><code>sudo apt update && sudo apt install -y x11vnc</code></pre>
                  </div>
                </li>
                <li>
                  <span className="step-title">
                    <strong>Skapa lösenord:</strong>
                  </span>
                  <div className="copyable-code">
                    <button
                      type="button"
                      onClick={() =>
                        copyCodeSnippet(
                          'vnc-password',
                          `mkdir -p ~/.vnc
x11vnc -storepasswd
chmod 600 ~/.vnc/passwd`,
                        )
                      }
                      aria-label="Kopiera kommando"
                      title={copiedCodeId === 'vnc-password' ? 'Kopierat' : 'Kopiera'}
                    >
                      {copiedCodeId === 'vnc-password' ? '✓' : '⧉'}
                    </button>
                    <pre><code>mkdir -p ~/.vnc
x11vnc -storepasswd
chmod 600 ~/.vnc/passwd</code></pre>
                  </div>
                </li>
                <li>
                  <span className="step-title">
                    <strong>Skapa systemd-service i</strong> <code>/etc/systemd/system/x11vnc.service</code>:
                  </span>
                  <div className="copyable-code">
                    <button
                      type="button"
                      onClick={() =>
                        copyCodeSnippet(
                          'vnc-service',
                          `sudo tee /etc/systemd/system/x11vnc.service > /dev/null <<'EOF'
[Unit]
Description=x11vnc server
After=display-manager.service
Wants=display-manager.service

[Service]
Type=simple
User=school
ExecStart=/usr/bin/x11vnc -display :0 -auth guess -forever -loop -noxdamage -repeat -rfbauth /home/school/.vnc/passwd -rfbport 5900 -shared
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF`,
                        )
                      }
                      aria-label="Kopiera kommando"
                      title={copiedCodeId === 'vnc-service' ? 'Kopierat' : 'Kopiera'}
                    >
                      {copiedCodeId === 'vnc-service' ? '✓' : '⧉'}
                    </button>
                    <pre><code>sudo tee /etc/systemd/system/x11vnc.service &gt; /dev/null &lt;&lt;'EOF'
[Unit]
Description=x11vnc server
After=display-manager.service
Wants=display-manager.service

[Service]
Type=simple
User=school
ExecStart=/usr/bin/x11vnc -display :0 -auth guess -forever -loop -noxdamage -repeat -rfbauth /home/school/.vnc/passwd -rfbport 5900 -shared
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF</code></pre>
                  </div>
                </li>
                <li>
                  <span className="step-title">
                    <strong>Starta tjänsten:</strong>
                  </span>
                  <div className="copyable-code">
                    <button
                      type="button"
                      onClick={() =>
                        copyCodeSnippet(
                          'vnc-start',
                          `sudo systemctl daemon-reload
sudo systemctl enable --now x11vnc.service
sudo systemctl status x11vnc.service --no-pager`,
                        )
                      }
                      aria-label="Kopiera kommando"
                      title={copiedCodeId === 'vnc-start' ? 'Kopierat' : 'Kopiera'}
                    >
                      {copiedCodeId === 'vnc-start' ? '✓' : '⧉'}
                    </button>
                    <pre><code>sudo systemctl daemon-reload
sudo systemctl enable --now x11vnc.service
sudo systemctl status x11vnc.service --no-pager</code></pre>
                  </div>
                </li>
                <li>
                  <span className="step-title">
                    <strong>Verifiera port:</strong>
                  </span>
                  <div className="copyable-code">
                    <button
                      type="button"
                      onClick={() => copyCodeSnippet('vnc-verify', 'ss -ltnp | grep 5900')}
                      aria-label="Kopiera kommando"
                      title={copiedCodeId === 'vnc-verify' ? 'Kopierat' : 'Kopiera'}
                    >
                      {copiedCodeId === 'vnc-verify' ? '✓' : '⧉'}
                    </button>
                    <pre><code>ss -ltnp | grep 5900</code></pre>
                  </div>
                </li>
                <li>Testa sedan Desktop-knappen i Abitti2 och fyll i VNC-lösenordet i modalen.</li>
              </ol>
            </details>
            <details className="info-expand">
              <summary>SSH</summary>
              <p>
                För terminalfunktionen i Abitti2 används SSH-nyckel från datorn där Abitti2-servern körs (Windows)
                till varje Ubuntu-server.
              </p>
              <ol className="info-steps">
                <li>
                  <span className="step-title">
                    <strong>På Abitti2-värddatorn (Windows)</strong>: skapa nyckelpar:
                  </span>
                  <div className="copyable-code">
                    <button
                      type="button"
                      onClick={() =>
                        copyCodeSnippet(
                          'ssh-keygen',
                          'ssh-keygen -t ed25519 -f .\\keys\\abitti2 -N ""',
                        )
                      }
                      aria-label="Kopiera kommando"
                      title={copiedCodeId === 'ssh-keygen' ? 'Kopierat' : 'Kopiera'}
                    >
                      {copiedCodeId === 'ssh-keygen' ? '✓' : '⧉'}
                    </button>
                    <pre><code>ssh-keygen -t ed25519 -f .\keys\abitti2 -N ""</code></pre>
                  </div>
                </li>
                <li>
                  <span className="step-title">
                    <strong>På Ubuntu-servern</strong>: skapa SSH-katalog och rättigheter:
                  </span>
                  <div className="copyable-code">
                    <button
                      type="button"
                      onClick={() =>
                        copyCodeSnippet(
                          'ssh-perms',
                          `mkdir -p ~/.ssh
chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys`,
                        )
                      }
                      aria-label="Kopiera kommando"
                      title={copiedCodeId === 'ssh-perms' ? 'Kopierat' : 'Kopiera'}
                    >
                      {copiedCodeId === 'ssh-perms' ? '✓' : '⧉'}
                    </button>
                    <pre><code>mkdir -p ~/.ssh
chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys</code></pre>
                  </div>
                </li>
                <li>
                  <span className="step-title">
                    <strong>På Abitti2-värddatorn (Windows)</strong>: kopiera public key till Ubuntu-servern:
                  </span>
                  <div className="copyable-code">
                    <button
                      type="button"
                      onClick={() =>
                        copyCodeSnippet(
                          'ssh-copy-key',
                          'type .\\keys\\abitti2.pub | ssh school@10.203.X.X "cat >> ~/.ssh/authorized_keys"',
                        )
                      }
                      aria-label="Kopiera kommando"
                      title={copiedCodeId === 'ssh-copy-key' ? 'Kopierat' : 'Kopiera'}
                    >
                      {copiedCodeId === 'ssh-copy-key' ? '✓' : '⧉'}
                    </button>
                    <pre><code>type .\keys\abitti2.pub | ssh school@10.203.X.X "cat &gt;&gt; ~/.ssh/authorized_keys"</code></pre>
                  </div>
                </li>
                <li>
                  <span className="step-title">
                    <strong>På Abitti2-värddatorn (Windows)</strong>: testa nyckelbaserad SSH:
                  </span>
                  <div className="copyable-code">
                    <button
                      type="button"
                      onClick={() =>
                        copyCodeSnippet(
                          'ssh-test',
                          'ssh -i .\\keys\\abitti2 -o BatchMode=yes school@10.203.X.X "echo ok"',
                        )
                      }
                      aria-label="Kopiera kommando"
                      title={copiedCodeId === 'ssh-test' ? 'Kopierat' : 'Kopiera'}
                    >
                      {copiedCodeId === 'ssh-test' ? '✓' : '⧉'}
                    </button>
                    <pre><code>ssh -i .\keys\abitti2 -o BatchMode=yes school@10.203.X.X "echo ok"</code></pre>
                  </div>
                </li>
                <li>
                  Byt ut IP-adressen i exemplen ovan till den server du konfigurerar, och upprepa för varje
                  Ubuntu-server i listan.
                </li>
              </ol>
            </details>
            <h3>Aktiva bokningar denna vecka</h3>
            <ul className="booking-list">
              {currentWeekBookings.map((booking) => {
                const server = servers.find((s) => s.id === booking.serverId)
                const teacher = teachers.find((t) => t.id === booking.teacherId)
                return (
                  <li key={booking.id}>
                    <span>
                      {formatDateWithWeekday(booking.date)} lektion {booking.lesson} - {server?.label ?? 'Server'} - {teacher?.name ?? 'Lärare'}
                    </span>
                    <button type="button" onClick={() => removeBooking(booking.id)}>
                      Radera
                    </button>
                  </li>
                )
              })}
            </ul>
          </article>
        </section>
      )}

      {isTerminalModalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={closeTerminalModal}>
          <div className="modal terminal-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="terminal-modal-close"
              onClick={closeTerminalModal}
              aria-label="Stäng terminalfönster"
              title="Stäng"
            >
              x
            </button>
            <h2>Serverterminal</h2>
            <p className="selection-hint">
              {servers.find((server) => server.id === terminalServerId)?.label || 'Server'}
              {terminalSession?.host ? ` (${terminalSession.host})` : ''}
            </p>
            <div className="terminal-toolbar-actions">
              <button
                type="button"
                onClick={() => connectTerminalSession(terminalServerId)}
                disabled={!terminalServerId || terminalStatus === 'connecting'}
              >
                {terminalStatus === 'connecting' ? 'Ansluter...' : 'Anslut igen'}
              </button>
              <button type="button" onClick={disconnectTerminalSession} disabled={!terminalSession}>
                Koppla ner
              </button>
            </div>
            {terminalError ? <p className="error">{terminalError}</p> : null}
            <TerminalConsole
              sessionId={terminalSession?.sessionId || terminalSession?.id || ''}
              clientId={terminalClientId}
              isAdminUnlocked={isAdminUnlocked}
              onStatusChange={setTerminalStatus}
              onError={setTerminalError}
            />
          </div>
        </div>
      ) : null}
      {isDesktopModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal desktop-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="terminal-modal-close"
              onClick={closeDesktopModal}
              aria-label="Stäng desktopfönster"
              title="Stäng"
            >
              x
            </button>
            <h2>Serverdesktop (beta)</h2>
            <p className="selection-hint">{desktopHost}</p>
            <label className="readonly-field">
              VNC-lösenord (om servern kräver)
              <input
                type="password"
                value={desktopPassword}
                onChange={(e) => {
                  setDesktopPassword(e.target.value)
                  setDesktopConnectRequested(false)
                  if (desktopStatus !== 'ready') setDesktopStatus('ready')
                }}
                placeholder="Valfritt"
              />
            </label>
            <div className="terminal-toolbar-actions">
              <button
                type="button"
                onClick={connectDesktopSession}
                disabled={!desktopHost || desktopStatus === 'connecting'}
              >
                {desktopStatus === 'connecting' ? 'Ansluter...' : 'Anslut desktop'}
              </button>
            </div>
            {desktopError ? <p className="error">{desktopError}</p> : null}
            <p className="selection-hint">Desktopstatus: {desktopStatus}</p>
            <DesktopConsole
              host={desktopHost}
              enabled={desktopConnectRequested}
              isAdminUnlocked={isAdminUnlocked}
              password={desktopPassword}
              onStatusChange={setDesktopStatus}
              onError={setDesktopError}
            />
          </div>
        </div>
      ) : null}
      {bulkBookingModalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setBulkBookingModalOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>Boka markerade celler</h2>
            <p>{selectedFreeCount} lediga celler valda.</p>
            <label>
              Lärare
              <select value={bookingTeacherId} onChange={(e) => setBookingTeacherId(e.target.value)}>
                <option value="">Välj lärare</option>
                {teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="responsible">
              <input type="checkbox" checked={bookingResponsible} onChange={(e) => setBookingResponsible(e.target.checked)} />
              Markera som serveransvarig
            </label>
            {errorMessage ? <p className="error">{errorMessage}</p> : null}
            <div className="modal-actions">
              <button type="button" onClick={() => setBulkBookingModalOpen(false)}>
                Avbryt
              </button>
              <button type="button" onClick={saveSelectedCells}>
                Boka
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isAddServerModalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setIsAddServerModalOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>Skapa ny server</h2>
            <form onSubmit={addServer} className="admin-form">
              <input value={adminServerForm.label} onChange={(e) => setAdminServerForm((prev) => ({ ...prev, label: e.target.value }))} placeholder="Server etikett" required />
              <input value={adminServerForm.name} onChange={(e) => setAdminServerForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="URL/Servernamn" required />
              <input value={adminServerForm.ip} onChange={(e) => setAdminServerForm((prev) => ({ ...prev, ip: e.target.value }))} placeholder="IP-adress" />
              <button type="button" onClick={searchNewServerUrl} disabled={isResolvingNewServerUrl}>
                {isResolvingNewServerUrl ? 'Söker...' : 'Sök URL'}
              </button>
              {newServerLookupInfo ? (
                <small>
                  VM IP: {newServerLookupInfo.vmIp} (källa: {newServerLookupInfo.source})
                </small>
              ) : null}
              <input type="color" value={adminServerForm.color} onChange={(e) => setAdminServerForm((prev) => ({ ...prev, color: e.target.value }))} aria-label="Ny serverfärg" />
              <textarea value={adminServerForm.info} onChange={(e) => setAdminServerForm((prev) => ({ ...prev, info: e.target.value }))} placeholder="Information" rows={2} />
              <div className="modal-actions">
                <button type="button" onClick={() => setIsAddServerModalOpen(false)}>
                  Avbryt
                </button>
                <button type="submit">Lägg till server</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {isAddTeacherModalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setIsAddTeacherModalOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>Skapa ny lärare</h2>
            <form onSubmit={addTeacher} className="admin-form">
              <input value={adminTeacherForm.name} onChange={(e) => setAdminTeacherForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Namn" required />
              <div className="modal-actions">
                <button type="button" onClick={() => setIsAddTeacherModalOpen(false)}>
                  Avbryt
                </button>
                <button type="submit">Lägg till lärare</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {contextMenu ? (
        <div
          className="context-menu"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          role="menu"
        >
          {contextMenu.canBook ? (
            <button
              type="button"
              onClick={() => {
                if (!bookingTeacherId && teachers[0]?.id) {
                  setBookingTeacherId(teachers[0].id)
                }
                setBookingResponsible(false)
                setBulkBookingModalOpen(true)
                closeContextMenu()
              }}
            >
              Boka
            </button>
          ) : null}
          {contextMenu.canUnbook ? (
            <button
              type="button"
              onClick={() => {
                if (contextMenu.hasMultipleBooked) {
                  removeSelectedBookings()
                } else if (contextMenu.unbookBookingId) {
                  removeBooking(contextMenu.unbookBookingId)
                }
                closeContextMenu()
              }}
            >
              {contextMenu.hasMultipleBooked ? 'Avboka markerade' : 'Avboka'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              clearSelection()
              closeContextMenu()
            }}
          >
            Rensa markering
          </button>
        </div>
      ) : null}
      {isAdminLoginModalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setIsAdminLoginModalOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>Admin-inloggning</h2>
            <form onSubmit={submitAdminPassword} className="admin-form">
              <label>
                Lösenord
                <input
                  type="password"
                  value={adminPasswordInput}
                  onChange={(e) => setAdminPasswordInput(e.target.value)}
                  autoFocus
                  required
                />
              </label>
              {adminLoginError ? <p className="error">{adminLoginError}</p> : null}
              <div className="modal-actions">
                <button type="button" onClick={() => setIsAdminLoginModalOpen(false)}>
                  Avbryt
                </button>
                <button type="submit">Logga in</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default App
