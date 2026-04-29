import 'dotenv/config'
import cors from 'cors'
import dns from 'node:dns/promises'
import { spawn } from 'node:child_process'
import express from 'express'
import fs from 'node:fs'
import { createServer } from 'node:http'
import net from 'node:net'
import path from 'node:path'
import pty from 'node-pty'
import sqlite3 from 'sqlite3'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'

const app = express()
const httpServer = createServer(app)
const PORT = Number(globalThis.process.env.APP_API_PORT || 3010)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DB_PATH = path.join(__dirname, 'abitti2.db')
const SSH_LOOKUP_USER = 'school'
const SSH_LOOKUP_KEY = './keys/abitti2'
const TERMINAL_IDLE_TIMEOUT_MS = 12 * 60 * 1000
const TERMINAL_MAX_INPUT_BYTES = 4096
const runtimeProcess = globalThis.process

function resolveSshExecutable() {
  const envPath = String(runtimeProcess.env.SSH_PATH || '').trim()
  if (envPath && fs.existsSync(envPath)) return envPath
  if (runtimeProcess.platform === 'win32') {
    const windir = String(runtimeProcess.env.WINDIR || 'C:\\Windows')
    const candidates = [
      path.join(windir, 'System32', 'OpenSSH', 'ssh.exe'),
      path.join(windir, 'Sysnative', 'OpenSSH', 'ssh.exe'),
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate
    }
    return 'ssh.exe'
  }
  return 'ssh'
}

function createTerminalProcess(hostCandidate) {
  const sshExecutable = resolveSshExecutable()
  const sshArgs = [
    '-i',
    SSH_LOOKUP_KEY,
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'ConnectTimeout=5',
    `${SSH_LOOKUP_USER}@${hostCandidate}`,
  ]

  // node-pty currently crashes on some Windows + Node versions; fallback to spawn.
  if (runtimeProcess.platform === 'win32') {
    const child = spawn(sshExecutable, ['-tt', ...sshArgs], {
      shell: false,
      cwd: runtimeProcess.cwd(),
      env: runtimeProcess.env,
      stdio: 'pipe',
    })
    return {
      write(data) {
        child.stdin.write(data)
      },
      resize() {
        // No-op on spawn fallback.
      },
      kill() {
        child.kill()
      },
      onData(handler) {
        child.stdout.on('data', (chunk) => handler(String(chunk)))
        child.stderr.on('data', (chunk) => handler(String(chunk)))
      },
      onExit(handler) {
        child.on('close', (exitCode, signal) => {
          handler({ exitCode, signal })
        })
      },
    }
  }

  const ptyProcess = pty.spawn(sshExecutable, sshArgs, {
    name: 'xterm-256color',
    cols: 120,
    rows: 35,
    cwd: runtimeProcess.cwd(),
    env: runtimeProcess.env,
  })
  return {
    write(data) {
      ptyProcess.write(data)
    },
    resize(cols, rows) {
      ptyProcess.resize(cols, rows)
    },
    kill() {
      ptyProcess.kill()
    },
    onData(handler) {
      ptyProcess.onData(handler)
    },
    onExit(handler) {
      ptyProcess.onExit(handler)
    },
  }
}

const DEFAULT_SERVERS = [
  {
    id: 'srv-1',
    label: 'Server 1',
    name: 'vitsailu-neuvokas.koe.abitti.net',
    ip: '10.203.17.178',
    color: '#8d153a',
    info: 'Exempelserver enligt tidigare schema.',
    urlUpdatedAt: '',
  },
  {
    id: 'srv-2',
    label: 'Server 2',
    name: 'reipas-elmioi.koe.abitti.net',
    ip: '',
    color: '#dc2626',
    info: '',
    urlUpdatedAt: '',
  },
  {
    id: 'srv-3',
    label: 'Server 3',
    name: 'kuponan-torailua.koe.abitti.net',
    ip: '',
    color: '#ea580c',
    info: '',
    urlUpdatedAt: '',
  },
  {
    id: 'srv-4',
    label: 'Server 4',
    name: 'dyspeik-matinen.netti.koe.abitti.net',
    ip: '',
    color: '#0f766e',
    info: '',
    urlUpdatedAt: '',
  },
]

const DEFAULT_TEACHERS = [
  { id: 't-1', name: 'Lärare 1' },
  { id: 't-2', name: 'Lärare 2' },
]

const db = new sqlite3.Database(DB_PATH)

app.use(cors())
app.use(express.json())

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err)
      else resolve(this)
    })
  })
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err)
      else resolve(rows)
    })
  })
}

const terminalSessionsById = new Map()
const terminalSessionByClientId = new Map()
const terminalStartRateLimitByClientId = new Map()

function parseBooleanHeader(value) {
  return String(value || '').toLowerCase() === 'true'
}

function requireAdmin(req, res) {
  const isUnlocked = parseBooleanHeader(req.headers['x-admin-unlocked'])
  if (!isUnlocked) {
    res.status(403).json({ error: 'Admin-läge krävs.' })
    return false
  }
  return true
}

function getClientId(req) {
  return String(req.headers['x-terminal-client-id'] || '').trim()
}

function normalizeShellHost(value) {
  return normalizeHost(value || '').trim()
}

async function getAllowedTerminalHosts() {
  const rows = await all('SELECT ip, name FROM servers')
  const allowed = new Set()
  for (const row of rows) {
    const ipHost = normalizeShellHost(row.ip)
    const nameHost = normalizeShellHost(row.name)
    if (ipHost) allowed.add(ipHost)
    if (nameHost) allowed.add(nameHost)
  }
  return allowed
}

function touchTerminalSession(session) {
  session.lastSeenAt = Date.now()
  if (session.idleTimer) clearTimeout(session.idleTimer)
  session.idleTimer = setTimeout(() => {
    closeTerminalSession(session.id, 'timeout')
  }, TERMINAL_IDLE_TIMEOUT_MS)
}

function closeTerminalSession(sessionId, reason = 'closed') {
  const session = terminalSessionsById.get(sessionId)
  if (!session) return
  if (session.idleTimer) {
    clearTimeout(session.idleTimer)
    session.idleTimer = null
  }
  try {
    session.terminalProcess.kill()
  } catch {
    // ignore
  }
  for (const socket of session.sockets) {
    try {
      socket.send(JSON.stringify({ type: 'closed', reason }))
      socket.close()
    } catch {
      // ignore
    }
  }
  terminalSessionsById.delete(sessionId)
  if (terminalSessionByClientId.get(session.clientId) === sessionId) {
    terminalSessionByClientId.delete(session.clientId)
  }
}

function runLocalLookupScript({ ip = '', host } = {}) {
  return new Promise((resolve, reject) => {
    if (!host) {
      reject(new Error('SSH host saknas för URL-uppslag.'))
      return
    }
    const args = [
      'server/scripts/find-abitti-url.mjs',
      '--user',
      SSH_LOOKUP_USER,
      '--host',
      host,
      '--key',
      SSH_LOOKUP_KEY,
    ]
    if (ip) {
      args.push('--ip', ip)
    }
    const child = spawn('node', args, { shell: false })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `lookup script failed (${code})`))
        return
      }
      resolve(stdout)
    })
  })
}

function runLocalPasswordLookupScript(host) {
  return new Promise((resolve, reject) => {
    const args = [
      'server/scripts/find-abitti-password.mjs',
      '--user',
      SSH_LOOKUP_USER,
      '--host',
      host,
      '--key',
      SSH_LOOKUP_KEY,
    ]
    const child = spawn('node', args, { shell: false })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `password lookup script failed (${code})`))
        return
      }
      resolve(stdout)
    })
  })
}

function parsePasswordLookupOutput(rawOutput) {
  const output = rawOutput.split(/\r?\n/)
  const result = {
    password: '',
    seed: [],
    source: 'naksu-password-seed',
    naksuVersion: '',
    wordsCount: 0,
  }
  for (const line of output) {
    if (line.startsWith('password=')) result.password = line.slice(9).trim()
    if (line.startsWith('source=')) result.source = line.slice(7).trim() || 'naksu-password-seed'
    if (line.startsWith('naksu_version=')) result.naksuVersion = line.slice(14).trim()
    if (line.startsWith('words_count=')) result.wordsCount = Number(line.slice(12).trim()) || 0
    if (line.startsWith('seed=')) {
      result.seed = line
        .slice(5)
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value))
    }
    if (line.startsWith('error=')) result.error = line.slice(6).trim()
  }
  return result
}

function runSshCommandToHost(host, command) {
  return new Promise((resolve, reject) => {
    const sshExecutable = resolveSshExecutable()
    const target = `${SSH_LOOKUP_USER}@${host}`
    const args = [
      '-i',
      SSH_LOOKUP_KEY,
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      'ConnectTimeout=3',
      target,
      command,
    ]
    const child = spawn(sshExecutable, args, { shell: false })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `ssh command failed (${code})`))
        return
      }
      resolve(stdout.trim())
    })
  })
}

function parseLookupOutput(rawOutput) {
  const output = rawOutput.split(/\r?\n/)
  const result = { ip: '', url: null, source: 'ssh-script', raw: rawOutput }
  for (const line of output) {
    if (line.startsWith('ip=')) result.ip = line.slice(3).trim()
    if (line.startsWith('url=')) result.url = line.slice(4).trim() || null
    if (line.startsWith('source=')) result.source = line.slice(7).trim() || 'ssh-script'
    if (line.startsWith('error=')) result.error = line.slice(6).trim()
    if (line.startsWith('domain_txt=')) result.domainTxt = line.slice(11).trim()
    if (line.startsWith('domain_txt_matches_ip=')) {
      result.domainTxtMatchesIp = line.slice(22).trim() === 'true'
    }
  }
  return result
}

function normalizeHost(value) {
  const input = String(value || '').trim()
  if (!input) return ''
  try {
    const url = input.startsWith('http://') || input.startsWith('https://')
      ? new URL(input)
      : new URL(`https://${input}`)
    return url.hostname
  } catch {
    return input.split('/')[0]
  }
}

function canConnect(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

function runPing(args) {
  return new Promise((resolve) => {
    const child = spawn('ping', args, { shell: false })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

async function canPing(host) {
  if (!host) return false
  const windowsOk = await runPing(['-n', '1', '-w', '1200', host])
  if (windowsOk) return true
  const unixOk = await runPing(['-c', '1', '-W', '1', host])
  return unixOk
}

async function initDb() {
  await run(`CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    name TEXT NOT NULL,
    ip TEXT NOT NULL,
    color TEXT NOT NULL,
    info TEXT NOT NULL,
    url_updated_at TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    hidden_from_booking INTEGER NOT NULL DEFAULT 0
  )`)
  await run('ALTER TABLE servers ADD COLUMN password TEXT NOT NULL DEFAULT ""').catch(() => {})
  await run('ALTER TABLE servers ADD COLUMN password_override INTEGER NOT NULL DEFAULT 0').catch(() => {})
  await run('ALTER TABLE servers ADD COLUMN password_source TEXT NOT NULL DEFAULT ""').catch(() => {})
  await run('ALTER TABLE servers ADD COLUMN password_updated_at TEXT NOT NULL DEFAULT ""').catch(() => {})
  await run('ALTER TABLE servers ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0').catch(() => {})
  await run('ALTER TABLE servers ADD COLUMN hidden_from_booking INTEGER NOT NULL DEFAULT 0').catch(() => {})

  await run(`CREATE TABLE IF NOT EXISTS teachers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  )`)

  await run(`CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    date TEXT NOT NULL,
    lesson INTEGER NOT NULL,
    responsible INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(server_id, date, lesson)
  )`)

  const currentServers = await all('SELECT id FROM servers')
  if (currentServers.length === 0) {
    for (const server of DEFAULT_SERVERS) {
      await run(
        `INSERT INTO servers(
          id, label, name, ip, color, info, url_updated_at, sort_order,
          password, password_override, password_source, password_updated_at, hidden_from_booking
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          server.id,
          server.label,
          server.name,
          server.ip,
          server.color,
          server.info,
          server.urlUpdatedAt,
          DEFAULT_SERVERS.findIndex((item) => item.id === server.id),
          '',
          0,
          '',
          '',
          0,
        ],
      )
    }
  }

  const currentTeachers = await all('SELECT id FROM teachers')
  if (currentTeachers.length === 0) {
    for (const teacher of DEFAULT_TEACHERS) {
      await run('INSERT INTO teachers(id, name, email) VALUES (?, ?, ?)', [teacher.id, teacher.name, ''])
    }
  }

  // Normalize persisted sort order so every server has a unique index.
  const orderedServers = await all('SELECT id FROM servers ORDER BY sort_order, label')
  for (const [index, server] of orderedServers.entries()) {
    await run('UPDATE servers SET sort_order = ? WHERE id = ?', [index, server.id])
  }
}

async function getState() {
  const servers = await all(
    `SELECT
      id,
      label,
      name,
      ip,
      color,
      info,
      url_updated_at as urlUpdatedAt,
      sort_order as sortOrder,
      hidden_from_booking as hiddenFromBooking,
      password,
      password_override as passwordOverride,
      password_source as passwordSource,
      password_updated_at as passwordUpdatedAt
    FROM servers
    ORDER BY sort_order, label`,
  )
  const teachers = await all('SELECT id, name FROM teachers ORDER BY name')
  const bookings = await all(
    `SELECT
      id,
      server_id as serverId,
      teacher_id as teacherId,
      date,
      lesson,
      responsible,
      created_at as createdAt
    FROM bookings
    ORDER BY date, lesson, server_id`,
  )
  return {
    servers,
    teachers,
    bookings: bookings.map((booking) => ({
      ...booking,
      responsible: Boolean(booking.responsible),
    })),
  }
}

app.get('/api/state', async (_req, res) => {
  try {
    res.json(await getState())
  } catch {
    res.status(500).json({ error: 'Kunde inte läsa data.' })
  }
})

app.get('/api/desktop/check', async (req, res) => {
  if (!requireAdmin(req, res)) return
  const host = normalizeShellHost(req.query.host || '')
  if (!host) {
    res.status(400).json({ error: 'Host saknas.' })
    return
  }
  try {
    const allowedHosts = await getAllowedTerminalHosts()
    if (!allowedHosts.has(host)) {
      res.status(403).json({ error: 'Host är inte tillåten för desktop.' })
      return
    }
    const reachable = await canConnect(host, 5900, 1800)
    res.json({ ok: true, host, reachable, port: 5900 })
  } catch (error) {
    res.status(500).json({ error: `Desktop-kontroll misslyckades: ${error.message}` })
  }
})

app.post('/api/terminal/session', async (req, res) => {
  if (!requireAdmin(req, res)) return
  const clientId = getClientId(req)
  if (!clientId) {
    res.status(400).json({ error: 'Klient-ID saknas.' })
    return
  }
  const now = Date.now()
  const lastStartAt = terminalStartRateLimitByClientId.get(clientId) || 0
  if (now - lastStartAt < 800) {
    res.status(429).json({ error: 'Vänta en kort stund innan ny anslutning.' })
    return
  }
  terminalStartRateLimitByClientId.set(clientId, now)

  const serverId = String(req.body?.serverId || '').trim()
  const preferredHost = normalizeShellHost(req.body?.host || '')
  if (!serverId) {
    res.status(400).json({ error: 'serverId saknas.' })
    return
  }
  try {
    const rows = await all('SELECT id, label, ip, name FROM servers WHERE id = ? LIMIT 1', [serverId])
    const server = rows[0]
    if (!server) {
      res.status(404).json({ error: 'Servern hittades inte.' })
      return
    }
    const ipHost = normalizeShellHost(server.ip)
    const nameHost = normalizeShellHost(server.name)
    const allowedHosts = await getAllowedTerminalHosts()
    const hostCandidate = preferredHost || ipHost || nameHost
    if (!hostCandidate) {
      res.status(400).json({ error: 'Servern saknar host/IP för SSH.' })
      return
    }
    if (!allowedHosts.has(hostCandidate)) {
      res.status(403).json({ error: 'Host är inte tillåten för terminal.' })
      return
    }

    const previousSessionId = terminalSessionByClientId.get(clientId)
    if (previousSessionId) closeTerminalSession(previousSessionId, 'replaced')

    const terminalProcess = createTerminalProcess(hostCandidate)
    const sessionId = crypto.randomUUID()
    const session = {
      id: sessionId,
      clientId,
      serverId,
      host: hostCandidate,
      label: server.label || 'Server',
      startedAt: now,
      lastSeenAt: now,
      terminalProcess,
      sockets: new Set(),
      idleTimer: null,
    }
    terminalProcess.onData((data) => {
      for (const socket of session.sockets) {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: 'output', data }))
        }
      }
    })
    terminalProcess.onExit(({ exitCode, signal }) => {
      for (const socket of session.sockets) {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: 'exit', exitCode, signal }))
        }
      }
      closeTerminalSession(session.id, 'process-exit')
    })
    terminalSessionsById.set(sessionId, session)
    terminalSessionByClientId.set(clientId, sessionId)
    touchTerminalSession(session)
    console.info(`[terminal] session started ${sessionId} -> ${hostCandidate}`)
    res.json({
      ok: true,
      sessionId,
      serverId,
      host: hostCandidate,
      label: session.label,
    })
  } catch (error) {
    res.status(500).json({ error: `Kunde inte starta terminal: ${error.message}` })
  }
})

app.get('/api/terminal/session/current', (req, res) => {
  if (!requireAdmin(req, res)) return
  const clientId = getClientId(req)
  if (!clientId) {
    res.status(400).json({ error: 'Klient-ID saknas.' })
    return
  }
  const sessionId = terminalSessionByClientId.get(clientId)
  if (!sessionId) {
    res.json({ session: null })
    return
  }
  const session = terminalSessionsById.get(sessionId)
  if (!session) {
    terminalSessionByClientId.delete(clientId)
    res.json({ session: null })
    return
  }
  touchTerminalSession(session)
  res.json({
    session: {
      id: session.id,
      serverId: session.serverId,
      host: session.host,
      label: session.label,
      startedAt: session.startedAt,
      lastSeenAt: session.lastSeenAt,
    },
  })
})

app.delete('/api/terminal/session/:id', (req, res) => {
  if (!requireAdmin(req, res)) return
  const clientId = getClientId(req)
  if (!clientId) {
    res.status(400).json({ error: 'Klient-ID saknas.' })
    return
  }
  const session = terminalSessionsById.get(req.params.id)
  if (!session) {
    res.status(404).json({ error: 'Sessionen hittades inte.' })
    return
  }
  if (session.clientId !== clientId) {
    res.status(403).json({ error: 'Sessionen tillhör annan klient.' })
    return
  }
  closeTerminalSession(session.id, 'user-closed')
  res.json({ ok: true })
})

app.get('/api/resolve-url', async (req, res) => {
  const ip = String(req.query.ip ?? '').trim()
  const hintRaw = String(req.query.hint ?? '').trim()
  if (!ip) {
    res.status(400).json({ error: 'IP saknas.' })
    return
  }
  const hintCandidates = []
  if (hintRaw) {
    const normalizedHint = normalizeHost(hintRaw)
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .trim()
    if (normalizedHint) {
      hintCandidates.push(normalizedHint)
      if (!normalizedHint.includes('.')) {
        hintCandidates.push(`${normalizedHint}.koe.abitti.net`)
      } else if (!normalizedHint.endsWith('.koe.abitti.net')) {
        hintCandidates.push(`${normalizedHint}.koe.abitti.net`)
      }
    }
  }
  for (const candidate of hintCandidates) {
    try {
      const lookup = await dns.lookup(candidate)
      if (lookup.address === ip) {
        res.json({
          ip,
          url: candidate,
          candidates: [candidate],
          source: 'hint-verify',
        })
        return
      }
    } catch {
      // Try next candidate.
    }
  }
  try {
    const reverseHosts = await dns.reverse(ip)
    const preferred =
      reverseHosts.find((host) => host.includes('.koe.abitti.net')) ??
      reverseHosts[0]
    res.json({
      ip,
      url: preferred ?? null,
      candidates: reverseHosts,
      source: 'reverse-dns',
    })
  } catch {
    try {
      const service = await dns.lookupService(ip, 80)
      res.json({
        ip,
        url: service.hostname || null,
        candidates: service.hostname ? [service.hostname] : [],
        source: 'lookup-service',
      })
    } catch {
      res.json({
        ip,
        url: null,
        candidates: [],
        source: 'none',
        error: 'Ingen URL hittades för IP-adressen.',
      })
    }
  }
})

app.get('/api/resolve-url-ssh', async (req, res) => {
  const ip = String(req.query.ip ?? '').trim()
  if (!ip) {
    res.status(400).json({ ip: '', url: null, source: 'ssh-direct', error: 'IP saknas.' })
    return
  }
  try {
    const raw = await runLocalLookupScript({ ip, host: ip })
    const parsed = parseLookupOutput(raw)
    if (parsed.url) {
      res.json({
        ...parsed,
        ip,
        source: parsed.source ? `${parsed.source}-direct` : 'ssh-direct',
      })
      return
    }
    if (parsed.domainTxt && parsed.domainTxtMatchesIp) {
      res.json({
        ...parsed,
        ip,
        url: parsed.domainTxt,
        source: 'domain-txt-direct',
      })
      return
    }
    res.json({ ...parsed, ip, source: 'ssh-direct' })
  } catch (error) {
    res.status(500).json({
      ip,
      url: null,
      source: 'ssh-direct',
      error: `SSH-uppslag misslyckades: ${error.message}`,
    })
  }
})

app.post('/api/abitti-version-ssh-bulk', async (req, res) => {
  const targets = Array.isArray(req.body?.targets) ? req.body.targets : []
  const naksuLog = '/home/school/.local/share/digabi/naksu2/logs/naksu2.log'
  const command = `
if [ ! -f "${naksuLog}" ]; then
  echo ""
  exit 0
fi
grep -E 'API call: getInstalledVersion\\(\\) => v[0-9]' "${naksuLog}" 2>/dev/null |
  sed -n 's/.*=> \\(v[0-9][^ ]*\\).*/\\1/p' |
  tail -n 1
`

  const results = await Promise.all(
    targets.map(async (target) => {
      const host = normalizeHost(target.ip || '')
      if (!host) {
        return { id: target.id, version: null, source: 'naksu-log', error: 'IP saknas.' }
      }
      try {
        const output = await runSshCommandToHost(host, command)
        return {
          id: target.id,
          version: output || null,
          source: 'naksu-log',
          host,
        }
      } catch (error) {
        return {
          id: target.id,
          version: null,
          source: 'naksu-log',
          host,
          error: `SSH misslyckades: ${error.message}`,
        }
      }
    }),
  )

  res.json({ results })
})

app.post('/api/server-password-ssh-bulk', async (req, res) => {
  const targets = Array.isArray(req.body?.targets) ? req.body.targets : []
  const results = await Promise.all(
    targets.map(async (target) => {
      const host = normalizeHost(target.ip || '')
      if (!host) {
        return { id: target.id, password: '', source: 'naksu-password-seed', error: 'IP saknas.' }
      }
      try {
        const raw = await runLocalPasswordLookupScript(host)
        const parsed = parsePasswordLookupOutput(raw)
        return {
          id: target.id,
          host,
          password: parsed.password || '',
          seed: parsed.seed || [],
          source: parsed.source || 'naksu-password-seed',
          naksuVersion: parsed.naksuVersion || '',
          wordsCount: parsed.wordsCount || 0,
          error: parsed.error || '',
        }
      } catch (error) {
        return {
          id: target.id,
          host,
          password: '',
          source: 'naksu-password-seed',
          error: `SSH/lösenordsuppslag misslyckades: ${error.message}`,
        }
      }
    }),
  )
  res.json({ results })
})

app.post('/api/server-status', async (req, res) => {
  const targets = Array.isArray(req.body?.targets) ? req.body.targets : []
  const results = await Promise.all(
    targets.map(async (target) => {
      const urlHost = normalizeHost(target.name || '')
      const ipHost = normalizeHost(target.ip || '')

      async function check(host) {
        if (!host) return { reachable: false, checkedHost: '' }
        let resolvedHost = host
        try {
          const dnsResult = await dns.lookup(host)
          resolvedHost = dnsResult.address
        } catch {
          // Keep original host if DNS lookup fails.
        }
        const tcp443 = await canConnect(resolvedHost, 443)
        const tcp80 = tcp443 ? true : await canConnect(resolvedHost, 80)
        return { reachable: tcp443 || tcp80, checkedHost: resolvedHost }
      }

      const urlResult = await check(urlHost)
      const ipResult = await check(ipHost)
      const ipPingOk = await canPing(ipHost)
      const ipReachable = ipResult.reachable || ipPingOk

      let state = 'down'
      if (urlResult.reachable) state = 'ok'
      else if (ipReachable) state = 'warn'

      return {
        id: target.id,
        state,
        urlReachable: urlResult.reachable,
        ipReachable,
        ipReachableBy: ipResult.reachable ? 'tcp' : ipPingOk ? 'ping' : 'none',
        checkedUrlHost: urlResult.checkedHost,
        checkedIpHost: ipResult.checkedHost,
      }
    }),
  )

  res.json({ results })
})

app.put('/api/meta', async (req, res) => {
  const { servers = [], teachers = [] } = req.body
  try {
    await run('BEGIN TRANSACTION')
    await run('DELETE FROM servers')
    await run('DELETE FROM teachers')

    for (const [index, server] of servers.entries()) {
      await run(
        `INSERT INTO servers(
          id, label, name, ip, color, info, url_updated_at, sort_order,
          password, password_override, password_source, password_updated_at, hidden_from_booking
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          server.id,
          server.label,
          server.name,
          server.ip ?? '',
          server.color,
          server.info ?? '',
          server.urlUpdatedAt ?? '',
          index,
          server.password ?? '',
          server.passwordOverride ? 1 : 0,
          server.passwordSource ?? '',
          server.passwordUpdatedAt ?? '',
          server.hiddenFromBooking ? 1 : 0,
        ],
      )
    }
    for (const teacher of teachers) {
      await run('INSERT INTO teachers(id, name, email) VALUES (?, ?, ?)', [
        teacher.id,
        teacher.name,
        '',
      ])
    }
    await run('COMMIT')
    res.json({ ok: true })
  } catch {
    await run('ROLLBACK')
    res.status(500).json({ error: 'Kunde inte spara server/lärare.' })
  }
})

app.post('/api/bookings/bulk', async (req, res) => {
  const { teacherId, responsible, cells = [] } = req.body
  if (!teacherId || !Array.isArray(cells) || cells.length === 0) {
    res.status(400).json({ error: 'Ogiltig bokningsdata.' })
    return
  }

  const now = new Date().toISOString()
  try {
    await run('BEGIN TRANSACTION')
    for (const cell of cells) {
      const id = `b-${crypto.randomUUID()}`
      await run(
        `INSERT INTO bookings(id, server_id, teacher_id, date, lesson, responsible, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          cell.serverId,
          teacherId,
          cell.date,
          cell.lesson,
          responsible ? 1 : 0,
          now,
        ],
      )
    }
    await run('COMMIT')
    res.json({ ok: true })
  } catch (err) {
    await run('ROLLBACK')
    if (String(err.message).includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: 'En eller flera tider är redan bokade.' })
      return
    }
    res.status(500).json({ error: 'Kunde inte skapa bokning.' })
  }
})

app.delete('/api/bookings/:id', async (req, res) => {
  try {
    await run('DELETE FROM bookings WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'Kunde inte avboka.' })
  }
})

app.post('/api/bookings/bulk-delete', async (req, res) => {
  const bookingIds = Array.isArray(req.body?.bookingIds) ? req.body.bookingIds : []
  if (!bookingIds.length) {
    res.status(400).json({ error: 'Inga bokningar valda.' })
    return
  }
  try {
    await run('BEGIN TRANSACTION')
    for (const bookingId of bookingIds) {
      await run('DELETE FROM bookings WHERE id = ?', [bookingId])
    }
    await run('COMMIT')
    res.json({ ok: true })
  } catch {
    await run('ROLLBACK')
    res.status(500).json({ error: 'Kunde inte avboka markerade.' })
  }
})

const terminalWss = new WebSocketServer({ noServer: true })
const desktopWss = new WebSocketServer({
  noServer: true,
  handleProtocols(protocols) {
    if (protocols.has('binary')) return 'binary'
    if (protocols.has('base64')) return 'base64'
    return false
  },
})

httpServer.on('upgrade', (req, socket, head) => {
  try {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`)
    if (url.pathname === '/api/terminal/ws') {
      const isAdmin = parseBooleanHeader(url.searchParams.get('admin'))
      const clientId = String(url.searchParams.get('clientId') || '').trim()
      const sessionId = String(url.searchParams.get('sessionId') || '').trim()
      if (!isAdmin || !clientId || !sessionId) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }
      const session = terminalSessionsById.get(sessionId)
      if (!session || session.clientId !== clientId) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
        socket.destroy()
        return
      }
      terminalWss.handleUpgrade(req, socket, head, (ws) => {
        terminalWss.emit('connection', ws, { session, clientId })
      })
      return
    }
    if (url.pathname === '/api/desktop/ws') {
      const isAdmin = parseBooleanHeader(url.searchParams.get('admin'))
      const host = normalizeShellHost(url.searchParams.get('host') || '')
      if (!isAdmin || !host) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }
      desktopWss.handleUpgrade(req, socket, head, (ws) => {
        desktopWss.emit('connection', ws, { host })
      })
      return
    }
    socket.destroy()
  } catch {
    socket.destroy()
  }
})

terminalWss.on('connection', (ws, context) => {
  const session = context?.session
  if (!session) {
    ws.close()
    return
  }
  session.sockets.add(ws)
  touchTerminalSession(session)
  ws.send(
    JSON.stringify({
      type: 'ready',
      sessionId: session.id,
      host: session.host,
      label: session.label,
    }),
  )
  ws.on('message', (rawData) => {
    try {
      const message = JSON.parse(String(rawData || '{}'))
      if (message.type === 'input') {
        const data = String(message.data || '')
        if (new TextEncoder().encode(data).length > TERMINAL_MAX_INPUT_BYTES) return
        session.terminalProcess.write(data)
        touchTerminalSession(session)
        return
      }
      if (message.type === 'resize') {
        const cols = Number(message.cols)
        const rows = Number(message.rows)
        if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0) {
          session.terminalProcess.resize(cols, rows)
          touchTerminalSession(session)
        }
      }
    } catch {
      // Ignore malformed messages.
    }
  })
  ws.on('close', () => {
    session.sockets.delete(ws)
    touchTerminalSession(session)
  })
  ws.on('error', () => {
    session.sockets.delete(ws)
  })
})

desktopWss.on('connection', async (ws, context) => {
  const host = normalizeShellHost(context?.host || '')
  if (!host) {
    ws.close()
    return
  }
  const allowedHosts = await getAllowedTerminalHosts()
  if (!allowedHosts.has(host)) {
    ws.close(1008, 'Host not allowed')
    return
  }
  const vncSocket = net.connect(5900, host)
  vncSocket.on('data', (chunk) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(chunk)
    }
  })
  vncSocket.on('error', () => {
    try {
      ws.close(1011, 'VNC connection failed')
    } catch {
      // ignore
    }
  })
  vncSocket.on('close', () => {
    try {
      ws.close()
    } catch {
      // ignore
    }
  })
  ws.on('message', (data) => {
    if (vncSocket.writable) {
      vncSocket.write(data)
    }
  })
  ws.on('close', () => {
    try {
      vncSocket.destroy()
    } catch {
      // ignore
    }
  })
})

initDb()
  .then(() => {
    httpServer.listen(PORT, () => {
      console.log(`API körs på http://localhost:${PORT}`)
    })
  })
  .catch((err) => {
    console.error('Kunde inte starta API:', err)
  })
