# NomaFlash — Claude Code Build Spec

## Project Overview

**Repo:** `NomaFlash` (GitHub Pages, branch `gh-pages` or `main` with `/docs` root)  
**URL:** `https://[username].github.io/NomaFlash/`  
**Purpose:** Browser-based ESP32 flasher + post-flash test runner. No backend. Pure static site using Web Serial API.

---

## Architecture

```
NomaFlash/
├── index.html              # Main SPA shell
├── assets/
│   ├── css/
│   │   └── nomaflash.css   # All styles (NomaDirection tokens)
│   ├── js/
│   │   ├── app.js          # Main controller
│   │   ├── flasher.js      # Web Serial + esptool-js integration
│   │   ├── tester.js       # Post-flash test runner
│   │   └── devices/        # Per-device config modules
│   │       ├── esp32c3.js
│   │       └── xteink-x4.js
│   └── firmware/           # Compiled .bin files committed here
│       └── [project]/
│           └── firmware.bin
├── programs/               # One JSON per flashable program
│   ├── chess-xteink.json
│   └── hello-world-esp32c3.json
├── claude-api/
│   └── test-runner.md      # Claude Code test protocol spec (see §Test Integration)
└── CLAUDE.md               # This file
```

---

## Design System — NomaDirection Tokens

These are non-negotiable. Match nomadirection.pl exactly.

```css
:root {
  --color-navy:      #0D1B2A;   /* page background, nav */
  --color-teal:      #1A6B5A;   /* primary accent, CTA buttons */
  --color-teal-light:#22896F;   /* hover state */
  --color-white:     #FFFFFF;
  --color-off-white: #F2F4F6;   /* card backgrounds */
  --color-muted:     #8A9BB0;   /* secondary text */
  --color-danger:    #C0392B;
  --color-success:   #1A6B5A;
  --color-warning:   #D4A017;

  --font-display: 'Barlow', sans-serif;   /* headings, nav — weights 600/700 */
  --font-body:    'Barlow', sans-serif;   /* body — weight 400/500 */
  --font-mono:    'JetBrains Mono', 'Fira Code', monospace;  /* serial log, hex output */

  --radius:  4px;
  --shadow:  0 2px 12px rgba(0,0,0,0.18);
  --transition: 0.2s ease;
}
```

**Google Fonts import required:**
```html
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

**Visual rules:**
- Dark navy background everywhere — this is a tool, not a marketing page
- Teal for all interactive affordances (buttons, active states, progress bars)
- Mono font exclusively in the serial terminal and hex/address output
- Card pattern: `--color-off-white` bg, 1px border `rgba(255,255,255,0.08)`, `--radius`, `--shadow`
- No gradients except subtle overlay on hero header strip
- NomaDirection dot accent on the wordmark: "Noma**Flash**" — the dot `·` in teal between Noma and Flash, same visual pattern as the parent brand

---

## Page Layout

### Single-page layout, three zones:

```
┌──────────────────────────────────────┐
│  NAV: [· NomaFlash logo]  [GitHub ↗] │
├──────────────────────────────────────┤
│  PROGRAM SELECTOR                    │
│  ┌──────────┐ ┌──────────┐           │
│  │ Chess    │ │ Hello    │  [+ Add]  │
│  │ XTEINK X4│ │ ESP32-C3 │           │
│  └──────────┘ └──────────┘           │
├──────────────────────────────────────┤
│  FLASH PANEL (active program)        │
│  Device: [ESP32-C3 ▾]  Baud: [460800]│
│  [▶ Connect & Flash]   [⬛ Abort]    │
│  ──────────────────────────────────  │
│  Progress: ████████░░░░ 67%          │
│  ──────────────────────────────────  │
│  SERIAL TERMINAL                     │
│  > Connecting...                     │
│  > Erasing flash...                  │
│  > Writing at 0x00010000... (67%)    │
├──────────────────────────────────────┤
│  TEST PANEL  [▶ Run Tests] [📋 Copy] │
│  ┌──────┬───────────────┬──────────┐ │
│  │ #    │ Test          │ Result   │ │
│  ├──────┼───────────────┼──────────┤ │
│  │ 1    │ Boot check    │ ✓ PASS   │ │
│  │ 2    │ Serial ping   │ ✓ PASS   │ │
│  │ 3    │ Display init  │ ✗ FAIL   │ │
│  └──────┴───────────────┴──────────┘ │
└──────────────────────────────────────┘
```

---

## Program Configuration Schema

Each program is defined in `programs/*.json`:

```json
{
  "id": "chess-xteink-x4",
  "name": "Chess — XTEINK X4",
  "description": "Minimax chess engine for XTEINK X4 e-ink display (ESP32-C3)",
  "device": "esp32c3",
  "firmware": "assets/firmware/chess-xteink/firmware.bin",
  "flashOffset": "0x0",
  "baud": 460800,
  "tests": [
    {
      "id": "boot",
      "name": "Boot check",
      "type": "serial_expect",
      "pattern": "NomaChess ready",
      "timeoutMs": 5000
    },
    {
      "id": "display_init",
      "name": "Display init",
      "type": "serial_expect",
      "pattern": "EPD init OK",
      "timeoutMs": 8000
    },
    {
      "id": "ping",
      "name": "Serial ping",
      "type": "serial_send_expect",
      "send": "PING\n",
      "pattern": "PONG",
      "timeoutMs": 2000
    }
  ]
}
```

**Test types:**
- `serial_expect` — wait for regex pattern in serial stream
- `serial_send_expect` — write to serial, expect pattern in response
- `gpio_check` — future: WebUSB GPIO read (stub for now)

---

## Flash Implementation

Use **esptool-js** from CDN (official Espressif library, WebSerial-based):

```html
<script src="https://unpkg.com/esptool-js@0.4.3/bundle.js"></script>
```

**Flash flow in `flasher.js`:**

1. `navigator.serial.requestPort()` — user picks COM port
2. Open port at selected baud
3. Instantiate `ESPLoader` with transport
4. `esploader.main_fn()` — chip sync
5. Read `firmware.bin` via `fetch(program.firmware)` → `ArrayBuffer`
6. `esploader.write_flash(...)` with progress callback → update progress bar + terminal
7. On completion: emit `flash:complete` event → `tester.js` picks up
8. Hard reset device (RTS toggle)

**Error handling:**
- No Web Serial API → show banner with browser requirements (Chrome/Edge 89+, HTTPS or localhost)
- Port busy → clear error message, retry button
- Flash verify failure → show offset + expected/got hex diff in terminal

---

## Test Runner (`tester.js`)

Listens for `flash:complete` event.  
Reopens serial port at 115200 (monitoring baud).  
Runs `program.tests` array sequentially.  
Updates test table rows live (pending → pass/fail with color).

**Claude Code integration hook:**

After all tests complete, `tester.js` writes a structured JSON result to `window.__nomaflash_last_result`:

```json
{
  "timestamp": "2026-06-29T10:00:00Z",
  "program": "chess-xteink-x4",
  "device": "esp32c3",
  "chipId": "0xABCD1234",
  "flashDurationMs": 4200,
  "tests": [
    { "id": "boot", "name": "Boot check", "status": "pass", "durationMs": 1200, "matched": "NomaChess ready" },
    { "id": "display_init", "name": "Display init", "status": "fail", "durationMs": 8000, "error": "timeout" }
  ],
  "summary": { "total": 3, "passed": 2, "failed": 1 }
}
```

This object is also serialized to `sessionStorage` key `nomaflash_result` and posted to `window.opener` via `postMessage` if present — enabling Claude Code to drive the page in a subprocess browser and read results.

**Claude Code can:**
1. Open `http://localhost:PORT` (or the Pages URL) via Playwright/Puppeteer
2. Inject: `await page.evaluate(() => window.__nomaflash_trigger_flash('chess-xteink-x4'))`
   — this auto-selects the program and begins flash without UI interaction
3. Poll: `await page.evaluate(() => window.__nomaflash_last_result)`
4. Assert test results programmatically

Expose these on `window`:
- `window.__nomaflash_trigger_flash(programId)` — headless flash trigger
- `window.__nomaflash_last_result` — last complete test result object
- `window.__nomaflash_status` — `'idle' | 'flashing' | 'testing' | 'done' | 'error'`

---

## Adding New Programs

**Process (zero manual HTML editing):**

1. Compile firmware → commit `.bin` to `assets/firmware/[program-id]/firmware.bin`
2. Create `programs/[program-id].json` with config schema above
3. `app.js` auto-discovers all JSON files listed in `programs/index.json`
4. New card appears in Program Selector automatically

**`programs/index.json`** — maintained manually or by Claude Code:
```json
["chess-xteink-x4", "hello-world-esp32c3"]
```

---

## GitHub Pages Deployment

- **No build step.** Pure vanilla HTML/CSS/JS — no bundler, no Node.
- All assets self-contained except Google Fonts CDN and esptool-js CDN.
- Web Serial API requires HTTPS → GitHub Pages provides this automatically.
- `404.html` → copy of `index.html` (SPA fallback not needed, single page).

**gh-pages branch layout:**
```
/ (root)
├── index.html
├── assets/
├── programs/
└── claude-api/
```

---

## Accessibility & Browser Requirements

- Show clear **compatibility banner** if `!('serial' in navigator)`:
  ```
  ⚠ Web Serial API required. Use Chrome or Edge 89+ over HTTPS.
  ```
- All interactive elements keyboard-accessible
- Terminal output: `role="log"`, `aria-live="polite"`
- Color is never the only indicator — status icons + text alongside color
- `prefers-reduced-motion`: disable progress bar animation

---

## Implementation Order

Claude Code must execute in this order:

1. **Scaffold repo structure** — all dirs, empty placeholder files
2. **`nomaflash.css`** — full design system, responsive (mobile ≥ 375px)
3. **`index.html`** — semantic shell, all sections, no inline styles
4. **`programs/index.json` + two sample `programs/*.json`** — chess-xteink-x4, hello-world-esp32c3
5. **`app.js`** — program loader, card renderer, event wiring
6. **`flasher.js`** — full esptool-js integration with progress + terminal
7. **`tester.js`** — serial test runner, result object, `window.__nomaflash_*` API
8. **`assets/devices/esp32c3.js`** — device descriptor (chip name, flash size, default baud)
9. **Smoke test** — open `index.html` locally, verify program cards render, verify UI responds to serial connect attempt (no firmware needed for UI test)
10. **Commit** all files, push to `main`, verify GitHub Pages deploys

---

## Dispatch Report-Back Instructions

After completing each numbered step above, post a Dispatch message in this format:

```
[NomaFlash] Step N complete: [one-line summary]
Files changed: [list]
Status: OK | BLOCKED (reason)
Next: Step N+1
```

After step 10, post final summary:
```
[NomaFlash] DONE
URL: https://[username].github.io/NomaFlash/
Files committed: [count]
Known issues: [list or "none"]
Manual steps required: [e.g. "Add firmware .bin files to assets/firmware/"]
```

If blocked at any step (missing dependency, API unavailable, ambiguous spec), post:
```
[NomaFlash] BLOCKED at Step N
Reason: [specific]
Options: [A / B / C]
Waiting for input.
```

Do not proceed past a blocked step without response.

---

## Out of Scope for v1

- OTA update via WiFi
- Multi-file flash (partitions table, bootloader separate)
- Drag-and-drop custom firmware upload (add in v2 — just note the hook point in code)
- Authentication / access control
- Analytics
