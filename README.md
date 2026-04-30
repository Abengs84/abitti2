# Abitti2 bokningssystem

Webbapp för att hantera Abitti2-servrar, bokningar, serverstatus och fjärråtkomst (SSH-terminal + browserbaserad desktop).

## Funktioner

- Bokning av servrar per dag/lektion/lärare.
- Adminvy för servrar/lärare med persistent lagring i SQLite.
- URL-/lösenordsuppslag via SSH (Naksu2-relaterade script).
- Serverstatus med röd/gul/grön indikator.
- Sorterbar serverordning och möjlighet att gömma servrar från bokningsvyn.
- Inbyggd SSH-terminal per server i admin.
- Browserbaserad desktop (beta) via VNC-tunnel.
- Systeminformation med utfällbara instruktioner för VNC och SSH.

## Teknik

- Frontend: React + Vite
- Backend/API: Express
- Databas: SQLite (`server/abitti2.db`)
- Terminal: `node-pty` (Linux/macOS) + Windows fallback med `child_process`
- Desktop: noVNC (`@novnc/novnc`) via WebSocket-tunnel till VNC (`:5900`)

## Krav

- Node.js 20+
- npm
- SSH-klient tillgänglig på värddatorn
- För desktop-funktionen: VNC-tjänst på Ubuntu-server (t.ex. `x11vnc`)

## Miljövariabler

Skapa `.env` från `.env.example`:

```bash
cp .env.example .env
```

Stödda variabler:

- `APP_WEB_PORT` - port för Vite/webbapp (default `3006`)
- `APP_API_PORT` - port för API/server (default `3010`)
- `VITE_API_PORT` - API-port som frontend använder för desktop-WS (default `3010`)
- `VITE_API_TARGET` - valfri override för Vite proxy target

## Start

Installera beroenden:

```bash
npm install
```

Utvecklingsläge (web + api):

```bash
npm run dev
```

Bygg:

```bash
npm run build
```

Lint:

```bash
npm run lint
```

## Viktiga mappar/filer

- `src/App.jsx` - huvudsida och adminlogik
- `src/components/TerminalConsole.jsx` - SSH-terminal i UI
- `src/components/DesktopConsole.jsx` - noVNC-klient
- `server/server.js` - API, SSH, terminal- och desktop-websocket
- `server/scripts/` - script för URL/lösenordsuppslag
- `keys/` - SSH-nycklar (ignoreras i git)

Notering: Naksu-ordlista genereras lokalt till `server/scripts/naksu-password-words.local.json` och checkas inte in i git.

## SSH-nycklar

Appen använder nyckelbaserad SSH mot Ubuntu-servrar. Standardnyckel i projektet:

- Privat: `keys/abitti2`
- Publik: `keys/abitti2.pub`

Säkerställ att public key finns i `~/.ssh/authorized_keys` på varje Ubuntu-server.

## Naksu-ordlista (lokal generation)

Övervakarlösenord kräver en lokal ordlista. Av säkerhetsskäl checkas den inte in publikt.

1. Extrahera Naksu2-källan lokalt så `words.ts` finns (default-sökväg):
   - `temp-naksu2-app/src/renderer/password/words.ts`
2. Generera lokal ordlista:

```bash
npm run naksu:words:generate
```

Detta skapar:

- `server/scripts/naksu-password-words.local.json` (ignoreras i git)

Valfritt: sätt egen sökväg med env:

- `NAKSU_WORDS_PATH=/path/to/words.json`

## Desktop (VNC) - förutsättningar

Desktop i browsern kräver att servern lyssnar på VNC-port `5900`.

Rekommenderad setup på Ubuntu: `x11vnc` som systemd-tjänst.
Instruktioner finns i appen under:

- `Administrering -> Systeminformation -> VNC`

## Kända begränsningar

- Desktop är markerad som beta.
- noVNC kräver fungerande VNC-backend (inte bara RDP).
- Vissa VNC-servrar tillåter inte resize från klient (`Resize is administratively prohibited`), vilket är normalt.

## Säkerhet

- Kör tjänsten på internt nät (LAN).
- Begränsa åtkomst till VNC/SSH via brandvägg där möjligt.
- Dela aldrig privata nycklar eller `.env` med känsliga värden.
