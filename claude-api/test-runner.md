# NomaFlash — Claude Code Test Protocol

## Headless Flash + Test via Playwright

```js
const { chromium } = require('playwright');

async function runNomaFlash(programId, port = 3000) {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(() => window.__nomaflash_status === 'idle');

  // Trigger flash without UI interaction
  await page.evaluate((id) => window.__nomaflash_trigger_flash(id), programId);

  // Poll until done or error
  await page.waitForFunction(
    () => ['done', 'error'].includes(window.__nomaflash_status),
    { timeout: 120_000 }
  );

  const result = await page.evaluate(() => window.__nomaflash_last_result);
  await browser.close();
  return result;
}
```

## Result Schema

```json
{
  "timestamp": "ISO8601",
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

## Window API

| Symbol | Type | Description |
|--------|------|-------------|
| `window.__nomaflash_trigger_flash(id)` | function | Auto-select program and begin flash |
| `window.__nomaflash_last_result` | object | Last completed test result |
| `window.__nomaflash_status` | string | `'idle'|'flashing'|'testing'|'done'|'error'` |

Results are also written to `sessionStorage.nomaflash_result` (JSON) and posted to `window.opener` via `postMessage`.
