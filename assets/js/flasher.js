/* NomaFlash — flasher.js: Web Serial + esptool-js integration */

(function () {
  'use strict';

  const terminal = document.getElementById('terminal');
  let aborted = false;
  let currentLoader = null;
  let currentTransport = null;

  function log(msg, cls = 'info') {
    const p = document.createElement('p');
    p.className = `terminal-line ${cls}`;
    p.textContent = `> ${msg}`;
    terminal.appendChild(p);
    terminal.scrollTop = terminal.scrollHeight;
  }

  function clearTerminal() {
    terminal.innerHTML = '';
  }

  function emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  async function start(program, baud) {
    if (!('serial' in navigator)) {
      log('Web Serial API not available. Use Chrome or Edge 89+.', 'error');
      return;
    }

    aborted = false;
    clearTerminal();
    emit('flash:start');
    window.__nomaflash_status = 'flashing';

    const flashStart = Date.now();

    try {
      log('Requesting serial port…');
      const port = await navigator.serial.requestPort();

      log(`Opening port at ${baud} baud…`);

      const transport = new Transport(port, true);
      currentTransport = transport;

      const loaderOptions = {
        transport,
        baudrate: baud,
        terminal: {
          clean() { },
          writeLine(data) { log(data, 'dim'); },
          write(data)     { log(data, 'dim'); },
        },
        debugLogging: false,
      };

      log('Connecting to chip…');
      const loader = new ESPLoader(loaderOptions);
      currentLoader = loader;

      const chip = await loader.main();
      log(`Connected: ${chip}`, 'ok');

      if (aborted) throw new Error('Aborted by user');

      log(`Fetching firmware: ${program.firmware}`);
      const res = await fetch(program.firmware);
      if (!res.ok) throw new Error(`Firmware fetch failed: ${res.status} ${res.statusText}`);
      const buf = await res.arrayBuffer();
      log(`Firmware loaded: ${(buf.byteLength / 1024).toFixed(1)} KB`);

      if (aborted) throw new Error('Aborted by user');

      const uint8 = new Uint8Array(buf);
      let binStr = '';
      for (let i = 0; i < uint8.length; i++) binStr += String.fromCharCode(uint8[i]);

      const flashOffset = parseInt(program.flashOffset || '0x0', 16);

      log('Erasing flash…');

      await loader.write_flash({
        fileArray: [{ data: binStr, address: flashOffset }],
        flashSize: 'keep',
        flashMode: 'keep',
        flashFreq: 'keep',
        eraseAll: false,
        compress: true,
        reportProgress(fileIndex, written, total) {
          if (aborted) return;
          const pct = total > 0 ? (written / total) * 100 : 0;
          emit('flash:progress', { percent: pct, written, total });
          log(`Writing at 0x${(flashOffset + written).toString(16).padStart(8,'0')}… (${Math.round(pct)}%)`, 'info');
        },
        calculateMD5Hash(image) {
          return CryptoJS ? CryptoJS.MD5(CryptoJS.enc.Latin1.parse(image)).toString() : '';
        },
      });

      if (aborted) throw new Error('Aborted by user');

      log('Hard resetting via RTS…');
      await loader.after_flash(chip);

      const flashDurationMs = Date.now() - flashStart;
      log(`Flash complete in ${(flashDurationMs / 1000).toFixed(1)}s`, 'ok');

      await transport.disconnect();

      emit('flash:complete', { program, chip, flashDurationMs });
      window.__nomaflash_status = 'testing';

    } catch (err) {
      if (aborted) {
        log('Flash aborted.', 'warn');
      } else {
        log(`Error: ${err.message}`, 'error');
        if (err.message && err.message.includes('0x')) {
          log(`Hint: check wiring, hold BOOT button during connect, ensure port not busy.`, 'warn');
        }
      }
      if (currentTransport) {
        try { await currentTransport.disconnect(); } catch (_) { }
      }
      emit('flash:error', { error: err.message });
      window.__nomaflash_status = 'error';
    }

    currentLoader = null;
    currentTransport = null;
  }

  function abort() {
    aborted = true;
    log('Aborting…', 'warn');
    if (currentTransport) {
      try { currentTransport.disconnect(); } catch (_) { }
    }
  }

  window.__nomaflash_flasher = { start, abort };
})();
