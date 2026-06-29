/* NomaFlash — tester.js: post-flash serial test runner */

(function () {
  'use strict';

  const tbody = document.getElementById('test-tbody');
  const btnRun = document.getElementById('btn-run-tests');
  const btnCopy = document.getElementById('btn-copy-results');

  let currentProgram = null;
  let testRows = [];

  function loadProgram(prog) {
    currentProgram = prog;
    testRows = [];
    renderTable(prog.tests || []);
    btnRun.disabled = false;
  }

  function renderTable(tests) {
    if (!tests || !tests.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No tests defined for this program.</td></tr>';
      btnRun.disabled = true;
      btnCopy.disabled = true;
      return;
    }

    tbody.innerHTML = '';
    tests.forEach((test, i) => {
      const tr = document.createElement('tr');
      tr.id = `test-row-${test.id}`;
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${esc(test.name)}</td>
        <td><span class="status-badge pending" id="status-${test.id}">— pending</span></td>
        <td id="dur-${test.id}">—</td>
      `;
      tbody.appendChild(tr);
      testRows.push({ test, tr });
    });

    btnCopy.disabled = false;
  }

  function setRowStatus(id, status, detail = '') {
    const badge = document.getElementById(`status-${id}`);
    if (!badge) return;
    badge.className = `status-badge ${status}`;
    const icons = { pending: '—', running: '⟳', pass: '✓ PASS', fail: '✗ FAIL' };
    badge.textContent = (icons[status] || status) + (detail ? ` — ${detail}` : '');
  }

  function setRowDuration(id, ms) {
    const cell = document.getElementById(`dur-${id}`);
    if (cell) cell.textContent = ms != null ? `${ms}ms` : '—';
  }

  /* Run all tests sequentially via serial */
  async function runTests() {
    if (!currentProgram || !currentProgram.tests || !currentProgram.tests.length) return;
    if (!('serial' in navigator)) {
      alert('Web Serial API required. Use Chrome or Edge 89+.');
      return;
    }

    btnRun.disabled = true;
    window.__nomaflash_status = 'testing';

    const results = [];

    /* reset all rows to pending */
    currentProgram.tests.forEach(t => {
      setRowStatus(t.id, 'pending');
      setRowDuration(t.id, null);
    });

    let port, reader, writer;
    try {
      port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      reader = port.readable.getReader();
      writer = port.writable.getWriter();
    } catch (err) {
      btnRun.disabled = false;
      alert(`Could not open serial port: ${err.message}`);
      window.__nomaflash_status = 'error';
      return;
    }

    /* Stream accumulator */
    let rxBuf = '';
    let readerDone = false;

    async function pumpReader() {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) { readerDone = true; break; }
          rxBuf += new TextDecoder().decode(value);
        }
      } catch (_) { readerDone = true; }
    }

    const pump = pumpReader();

    async function waitForPattern(pattern, timeoutMs) {
      const re = new RegExp(pattern);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline && !readerDone) {
        if (re.test(rxBuf)) {
          const match = rxBuf.match(re);
          return match ? match[0] : true;
        }
        await sleep(50);
      }
      return null;
    }

    for (const test of currentProgram.tests) {
      setRowStatus(test.id, 'running');
      const t0 = Date.now();

      try {
        if (test.type === 'serial_send_expect') {
          rxBuf = '';
          await writer.write(new TextEncoder().encode(test.send));
        }

        const matched = await waitForPattern(test.pattern, test.timeoutMs || 5000);
        const durationMs = Date.now() - t0;

        if (matched) {
          setRowStatus(test.id, 'pass');
          setRowDuration(test.id, durationMs);
          results.push({ id: test.id, name: test.name, status: 'pass', durationMs, matched });
        } else {
          setRowStatus(test.id, 'fail', 'timeout');
          setRowDuration(test.id, durationMs);
          results.push({ id: test.id, name: test.name, status: 'fail', durationMs, error: 'timeout' });
        }
      } catch (err) {
        const durationMs = Date.now() - t0;
        setRowStatus(test.id, 'fail', err.message);
        setRowDuration(test.id, durationMs);
        results.push({ id: test.id, name: test.name, status: 'fail', durationMs, error: err.message });
      }
    }

    try { reader.cancel(); } catch (_) { }
    await pump;
    try { reader.releaseLock(); writer.releaseLock(); await port.close(); } catch (_) { }

    const passed = results.filter(r => r.status === 'pass').length;
    const result = {
      timestamp: new Date().toISOString(),
      program: currentProgram.id,
      device: currentProgram.device,
      tests: results,
      summary: { total: results.length, passed, failed: results.length - passed },
    };

    window.__nomaflash_last_result = result;
    window.__nomaflash_status = 'done';

    try { sessionStorage.setItem('nomaflash_result', JSON.stringify(result)); } catch (_) { }

    if (window.opener) {
      try { window.opener.postMessage({ type: 'nomaflash_result', result }, '*'); } catch (_) { }
    }

    btnRun.disabled = false;
    btnCopy.disabled = false;
  }

  btnRun.addEventListener('click', runTests);

  btnCopy.addEventListener('click', () => {
    const result = window.__nomaflash_last_result;
    if (!result) return;
    const text = JSON.stringify(result, null, 2);
    navigator.clipboard.writeText(text).then(() => {
      const orig = btnCopy.textContent;
      btnCopy.textContent = '✓ Copied';
      setTimeout(() => { btnCopy.textContent = orig; }, 1500);
    }).catch(() => {
      prompt('Copy result JSON:', text);
    });
  });

  /* Auto-run tests after flash completes */
  window.addEventListener('flash:complete', () => {
    if (currentProgram && currentProgram.tests && currentProgram.tests.length) {
      setTimeout(() => runTests(), 1500);
    }
  });

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  window.__nomaflash_tester = { loadProgram, runTests };
})();
