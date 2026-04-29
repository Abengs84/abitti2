import { spawn } from 'node:child_process'

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

async function main() {
  const args = parseArgs(process.argv)
  const user = args.user
  const host = args.host
  const ip = args.ip || ''
  const keyPath = args.key || './keys/abitti2'

  if (!user || !host) {
    console.log(
      'Usage: node server/scripts/find-abitti-url.mjs --user <user> --host <host> [--ip <ip>] [--key <path>]',
    )
    process.exit(1)
  }

  const remoteScript = `
set -e
IP="${ip}"
NAKSU_LOG="/home/school/.local/share/digabi/naksu2/logs/naksu2.log"
DOMAIN_TXT="/home/school/.local/share/digabi/naksu2/certs/domain.txt"

if [ -z "$IP" ] && [ -f "$NAKSU_LOG" ]; then
  IP=$(
    grep -Eo 'Domain [a-z0-9-]+\\.koe\\.abitti\\.net resolves to ([0-9]{1,3}\\.){3}[0-9]{1,3}' "$NAKSU_LOG" 2>/dev/null |
      awk '{print $NF}' |
      tail -n 1
  )
fi

DOMAIN_FROM_FILE=""
if [ -f "$DOMAIN_TXT" ]; then
  DOMAIN_FROM_FILE=$(tr -d '\\r' < "$DOMAIN_TXT" | head -n 1 | sed 's/[[:space:]]//g')
fi

if [ -z "$IP" ]; then
  echo "ip="
  if [ -n "$DOMAIN_FROM_FILE" ]; then
    echo "url=$DOMAIN_FROM_FILE"
    echo "source=domain-txt"
  else
    echo "error=Ingen IP angiven och ingen IP hittades i naksu2.log"
  fi
  exit 0
fi

if [ -n "$DOMAIN_FROM_FILE" ]; then
  RESOLVED_IP_FROM_FILE=$(getent ahostsv4 "$DOMAIN_FROM_FILE" | awk 'NR==1{print $1}')
  if [ "$RESOLVED_IP_FROM_FILE" = "$IP" ]; then
    echo "ip=$IP"
    echo "url=$DOMAIN_FROM_FILE"
    echo "source=domain-txt"
    echo "domain_txt=$DOMAIN_FROM_FILE"
    echo "domain_txt_matches_ip=true"
    exit 0
  fi
fi

PTR_CANDIDATES=$(
  {
    getent hosts "$IP" | awk '{print $2}'
    host "$IP" 2>/dev/null | sed -n 's/.*pointer \\(.*\\)\\.$/\\1/p'
    nslookup "$IP" 2>/dev/null | sed -n 's/.*name = \\(.*\\)\\.$/\\1/p'
  } | tr -d '\\r' | sed '/^$/d' | sort -u
)

ABITTI_CANDIDATES=$(
  {
    grep -RohE '[a-z0-9-]+\\.koe\\.abitti\\.net' /etc 2>/dev/null || true
    grep -RohE '[a-z0-9-]+\\.koe\\.abitti\\.net' /var/log 2>/dev/null || true
    grep -RohE '[a-z0-9-]+\\.koe\\.abitti\\.net' /var/lib 2>/dev/null || true
  } | tr -d '\\r' | sed '/^$/d' | sort -u
)

NAKSU_MATCHED_DOMAIN=""
if [ -f "$NAKSU_LOG" ]; then
  NAKSU_MATCHED_DOMAIN=$(
    grep -E "Domain [a-z0-9-]+\\.koe\\.abitti\\.net resolves to $IP" "$NAKSU_LOG" 2>/dev/null |
      sed -n 's/.*Domain \\([a-z0-9-]*\\.koe\\.abitti\\.net\\) resolves to .*/\\1/p' |
      tail -n 1
  )
fi

MATCHED_ABITTI=""
MATCH_SOURCE=""

DOMAIN_FROM_FILE_MATCHES_IP="false"
if [ -n "$DOMAIN_FROM_FILE" ]; then
  RESOLVED_IP_FROM_FILE=$(getent ahostsv4 "$DOMAIN_FROM_FILE" | awk 'NR==1{print $1}')
  if [ "$RESOLVED_IP_FROM_FILE" = "$IP" ]; then
    DOMAIN_FROM_FILE_MATCHES_IP="true"
    MATCHED_ABITTI="$DOMAIN_FROM_FILE"
    MATCH_SOURCE="domain-txt"
  fi
fi

if [ -n "$NAKSU_MATCHED_DOMAIN" ]; then
  if [ -z "$MATCHED_ABITTI" ]; then
    MATCHED_ABITTI="$NAKSU_MATCHED_DOMAIN"
    MATCH_SOURCE="naksu-log"
  fi
fi

for candidate in $ABITTI_CANDIDATES; do
  if [ -n "$MATCHED_ABITTI" ]; then
    break
  fi
  RESOLVED_IP=$(getent ahostsv4 "$candidate" | awk 'NR==1{print $1}')
  if [ "$RESOLVED_IP" = "$IP" ]; then
    MATCHED_ABITTI="$candidate"
    MATCH_SOURCE="dns-verify"
    break
  fi
done

echo "ip=$IP"
if [ -n "$MATCHED_ABITTI" ]; then
  echo "url=$MATCHED_ABITTI"
  echo "source=$MATCH_SOURCE"
fi
if [ -n "$DOMAIN_FROM_FILE" ]; then
  echo "domain_txt=$DOMAIN_FROM_FILE"
  echo "domain_txt_matches_ip=$DOMAIN_FROM_FILE_MATCHES_IP"
fi

echo "ptr_candidates<<EOF"
echo "$PTR_CANDIDATES"
echo "EOF"

echo "abitti_candidates<<EOF"
echo "$ABITTI_CANDIDATES"
echo "EOF"

if [ -f "$NAKSU_LOG" ]; then
  echo "naksu_log_tail<<EOF"
  grep -E 'koe\\.abitti\\.net|getDomain\\(\\)|Domain .* resolves to' "$NAKSU_LOG" 2>/dev/null | tail -n 20
  echo "EOF"
fi
`

  try {
    const output = await runSsh({ user, host, keyPath, remoteScript })
    console.log(output)
  } catch (error) {
    console.error(`Kunde inte köra SSH-uppslag: ${error.message}`)
    process.exit(1)
  }
}

main()
