import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) {
      args[key] = true
    } else {
      args[key] = value
      i += 1
    }
  }
  return args
}

function runSsh({ user, host, keyPath, remoteScript }) {
  return new Promise((resolve, reject) => {
    const target = `${user}@${host}`
    const sshArgs = [
      '-i',
      keyPath,
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      'ConnectTimeout=4',
      target,
      remoteScript,
    ]
    const child = spawn('ssh', sshArgs, { shell: false })
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
        reject(new Error(stderr.trim() || `ssh failed with code ${code}`))
        return
      }
      resolve(stdout.trim())
    })
  })
}

async function loadWordsFromExtractedNaksu() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(__dirname, './naksu-password-words.json'),
    path.resolve(__dirname, '../../temp-naksu2-app/src/renderer/password/words.ts'),
  ]
  for (const filePath of candidates) {
    try {
      const raw = await fs.readFile(filePath, 'utf8')
      let words = []
      if (filePath.endsWith('.json')) {
        words = JSON.parse(raw)
      } else {
        words = [...raw.matchAll(/'([^']+)'/g)].map((match) => match[1])
      }
      if (words.length > 1000) {
        return words
      }
    } catch {
      // Try next path.
    }
  }
  throw new Error('Kunde inte läsa Naksu2-ordlistan lokalt. Extrahera app.asar först.')
}

function parseRemoteOutput(raw) {
  const result = { passwordSeed: [], naksuVersion: '' }
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('seed=')) {
      result.passwordSeed = line
        .slice(5)
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value))
    }
    if (line.startsWith('naksu_version=')) {
      result.naksuVersion = line.slice(14).trim()
    }
  }
  return result
}

async function main() {
  const args = parseArgs(process.argv)
  const user = args.user
  const host = args.host
  const keyPath = args.key || './keys/abitti2'

  if (!user || !host) {
    console.log(
      'Usage: node server/scripts/find-abitti-password.mjs --user <user> --host <host> [--key <path>]',
    )
    process.exit(1)
  }

  const words = await loadWordsFromExtractedNaksu()
  const remoteScript = `
CONFIG="/home/school/.local/share/digabi/naksu2/naksu2-config.json"
VERSION_FILE="/usr/lib/naksu2/version"
if [ ! -f "$CONFIG" ]; then
  echo "error=naksu2-config.json hittades inte"
  exit 0
fi
seed=$(
  sed -n '/"passwordSeed"[[:space:]]*:[[:space:]]*\\[/, /\\]/p' "$CONFIG" |
    tr -d '\\r' |
    tr '\\n' ' ' |
    sed 's/[^0-9,]/ /g' |
    tr -s ' ' |
    sed 's/^ *//; s/ *$//' |
    tr ' ' ',' |
    sed 's/,,*/,/g; s/^,//; s/,$//'
)
echo "seed=$seed"
if [ -f "$VERSION_FILE" ]; then
  echo "naksu_version=$(cat "$VERSION_FILE" 2>/dev/null)"
fi
`

  try {
    const sshOutput = await runSsh({ user, host, keyPath, remoteScript })
    const parsed = parseRemoteOutput(sshOutput)
    if (!parsed.passwordSeed.length) {
      console.log('source=naksu-password-seed')
      console.log('error=Kunde inte läsa passwordSeed från servern.')
      process.exit(0)
    }
    const missingIndex = parsed.passwordSeed.find((index) => index < 0 || index >= words.length)
    if (missingIndex !== undefined) {
      console.log(`seed=${parsed.passwordSeed.join(',')}`)
      console.log(`words_count=${words.length}`)
      console.log('source=naksu-password-seed')
      console.log('error=Seed-index låg utanför ordlistans längd.')
      process.exit(0)
    }
    const password = parsed.passwordSeed.map((index) => words[index]).join(' ')
    console.log(`seed=${parsed.passwordSeed.join(',')}`)
    console.log(`password=${password}`)
    console.log(`words_count=${words.length}`)
    console.log(`naksu_version=${parsed.naksuVersion}`)
    console.log('source=naksu-password-seed')
  } catch (error) {
    console.error(`Kunde inte köra lösenordsuppslag via SSH: ${error.message}`)
    process.exit(1)
  }
}

main()
