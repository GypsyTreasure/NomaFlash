/* NomaFlash — app.js: program loader, card renderer, event wiring */

(function () {
  'use strict';

  let programs = [];
  let activeProgram = null;

  const grid = document.getElementById('program-grid');
  const btnFlash = document.getElementById('btn-flash');
  const deviceSelect = document.getElementById('device-select');
  const baudSelect = document.getElementById('baud-select');

  /* ── Compat check ── */
  if (!('serial' in navigator)) {
    document.getElementById('compat-banner').classList.add('visible');
    btnFlash.disabled = true;
  }

  /* ── Load programs from index.json ── */
  async function loadPrograms() {
    try {
      const idxRes = await fetch('programs/index.json');
      if (!idxRes.ok) throw new Error('Failed to fetch programs/index.json');
      const ids = await idxRes.json();

      const settled = await Promise.allSettled(
        ids.map(id => fetch(`programs/${id}.json`).then(r => r.json()))
      );

      programs = settled
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value);

      renderCards();
    } catch (err) {
      grid.innerHTML = `<div class="empty-state">Failed to load programs: ${err.message}</div>`;
    }
  }

  /* ── Render program cards ── */
  function renderCards() {
    if (!programs.length) {
      grid.innerHTML = '<div class="empty-state">No programs found.</div>';
      return;
    }

    grid.innerHTML = '';
    programs.forEach(prog => {
      const card = document.createElement('div');
      card.className = 'program-card';
      card.setAttribute('role', 'listitem');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', prog.name);
      card.dataset.id = prog.id;

      card.innerHTML = `
        <div class="program-card-name">${esc(prog.name)}</div>
        <div class="program-card-device">${esc(prog.device || '')} · ${esc(String(prog.baud || ''))}</div>
        <div class="program-card-desc">${esc(prog.description || '')}</div>
      `;

      card.addEventListener('click', () => selectProgram(prog));
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectProgram(prog); }
      });

      grid.appendChild(card);
    });
  }

  function selectProgram(prog) {
    activeProgram = prog;

    document.querySelectorAll('.program-card').forEach(c => {
      c.classList.toggle('active', c.dataset.id === prog.id);
      c.setAttribute('aria-pressed', c.dataset.id === prog.id ? 'true' : 'false');
    });

    /* sync device selector */
    const opt = deviceSelect.querySelector(`option[value="${prog.device}"]`);
    if (opt) deviceSelect.value = prog.device;

    /* sync baud */
    const baudOpt = baudSelect.querySelector(`option[value="${prog.baud}"]`);
    if (baudOpt) baudSelect.value = prog.baud;

    /* enable flash button if serial available */
    if ('serial' in navigator) btnFlash.disabled = false;

    /* populate test table */
    window.__nomaflash_tester && window.__nomaflash_tester.loadProgram(prog);

    document.getElementById('progress-label-text').textContent = `Ready to flash: ${prog.name}`;
    document.getElementById('progress-pct').textContent = '—';
    setProgress(0);
  }

  function setProgress(pct) {
    const bar = document.getElementById('progress-bar');
    const track = document.getElementById('progress-bar-track');
    bar.style.width = pct + '%';
    track.setAttribute('aria-valuenow', pct);
  }

  /* ── Flash button wiring ── */
  btnFlash.addEventListener('click', () => {
    if (!activeProgram) return;
    const baud = parseInt(baudSelect.value, 10);
    window.__nomaflash_flasher && window.__nomaflash_flasher.start(activeProgram, baud);
  });

  document.getElementById('btn-abort').addEventListener('click', () => {
    window.__nomaflash_flasher && window.__nomaflash_flasher.abort();
  });

  /* ── Flash event listeners ── */
  window.addEventListener('flash:progress', e => {
    const pct = Math.round(e.detail.percent);
    setProgress(pct);
    document.getElementById('progress-pct').textContent = pct + '%';
    document.getElementById('progress-label-text').textContent = 'Flashing…';
  });

  window.addEventListener('flash:complete', () => {
    setProgress(100);
    document.getElementById('progress-label-text').textContent = 'Flash complete';
    document.getElementById('progress-pct').textContent = '100%';
    document.getElementById('btn-abort').disabled = true;
    btnFlash.disabled = false;
  });

  window.addEventListener('flash:error', e => {
    document.getElementById('progress-label-text').textContent = 'Flash failed';
    document.getElementById('progress-pct').textContent = '';
    document.getElementById('btn-abort').disabled = true;
    btnFlash.disabled = false;
  });

  window.addEventListener('flash:start', () => {
    btnFlash.disabled = true;
    document.getElementById('btn-abort').disabled = false;
    setProgress(0);
    document.getElementById('progress-pct').textContent = '0%';
    document.getElementById('progress-label-text').textContent = 'Connecting…';
  });

  /* ── Headless API ── */
  window.__nomaflash_status = 'idle';
  window.__nomaflash_last_result = null;

  window.__nomaflash_trigger_flash = function (programId) {
    const prog = programs.find(p => p.id === programId);
    if (!prog) { console.error('NomaFlash: unknown program', programId); return; }
    selectProgram(prog);
    btnFlash.click();
  };

  /* ── HTML escape helper ── */
  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  loadPrograms();
})();
