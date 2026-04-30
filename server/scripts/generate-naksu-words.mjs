import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const asar = require('asar')

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

function extractWordsFromTs(raw) {
  const words = [...raw.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1])
  return words.filter(Boolean)
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function resolveSourcePath(__dirname, cliSource) {
  const candidateInputs = [
    cliSource || '',
    '../../temp-naksu2-app/src/renderer/password/words.ts',
    './naksu.json',
    './naksu-password-words.json',
    './naksu-password-words.local.json',
  ]
  const candidates = candidateInputs
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((item) => path.resolve(__dirname, item))
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate
  }
  throw new Error(
    'Ingen källfil hittades. Lägg words.ts i temp-naksu2-app eller en JSON-fil i server/scripts (t.ex. naksu.json).',
  )
}

function getAsarCandidates(__dirname) {
  const envAsarPath = String(process.env.NAKSU_ASAR_PATH || '').trim()
  const windowsProgramFiles = String(process.env.ProgramFiles || 'C:\\Program Files')
  return [
    envAsarPath,
    path.resolve(__dirname, '../../temp-naksu2-app.asar'),
    path.resolve(__dirname, '../../naksu2-app.asar'),
    path.join(windowsProgramFiles, 'Naksu2', 'resources', 'app.asar'),
    '/usr/lib/naksu2/resources/app.asar',
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
}

function extractWordsFromAsarArchive(asarPath) {
  const entryCandidates = [
    'src/renderer/password/words.ts',
    '/src/renderer/password/words.ts',
    '\\src\\renderer\\password\\words.ts',
    'src\\renderer\\password\\words.ts',
  ]
  let lastError = null
  for (const entry of entryCandidates) {
    try {
      const raw = String(asar.extractFile(asarPath, entry) || '')
      const words = extractWordsFromTs(raw)
      if (words.length >= 1000) return words
    } catch (error) {
      lastError = error
    }
  }
  if (lastError) throw lastError
  return []
}

async function loadWordsAuto(__dirname, cliSource) {
  try {
    const sourcePath = await resolveSourcePath(__dirname, cliSource)
    const raw = await fs.readFile(sourcePath, 'utf8')
    const words = sourcePath.endsWith('.json') ? JSON.parse(raw) : extractWordsFromTs(raw)
    return { words, source: sourcePath }
  } catch {
    // Continue and try app.asar candidates below.
  }

  for (const asarPath of getAsarCandidates(__dirname)) {
    if (!(await fileExists(asarPath))) continue
    try {
      const words = extractWordsFromAsarArchive(asarPath)
      if (words.length >= 1000) {
        return { words, source: `${asarPath}::src/renderer/password/words.ts` }
      }
    } catch {
      // Try next archive path.
    }
  }

  throw new Error(
    'Ingen källfil hittades. Tryck på "Generera Naksu-ordlista" efter att Naksu2 finns installerad, eller lägg naksu.json i server/scripts.',
  )
}

async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const args = parseArgs(process.argv)
  const { words, source } = await loadWordsAuto(__dirname, args.source)
  const outputPath = path.resolve(
    __dirname,
    args.output || './naksu-password-words.local.json',
  )
  if (!Array.isArray(words) || words.length < 1000) {
    throw new Error(`Ordlistan ser ogiltig ut (${words.length || 0} ord).`)
  }
  await fs.writeFile(outputPath, `${JSON.stringify(words, null, 2)}\n`, 'utf8')
  console.log(`Skrev ${words.length} ord till ${outputPath} (källa: ${source})`)
}

main().catch((error) => {
  console.error(`Kunde inte generera Naksu-ordlista: ${error.message}`)
  process.exit(1)
})
