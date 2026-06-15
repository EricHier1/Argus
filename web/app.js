const $ = (id) => document.getElementById(id);
const fmt = (ts) => new Date(ts * 1000).toLocaleString();
async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// --- status ----------------------------------------------------------------
async function pollStatus() {
  try {
    const s = await api('/api/status');
    updatePowerButton(s.paused);
    const el = $('status');
    if (s.paused) {
      el.className = 'status';
      el.innerHTML = `<span class="dot"></span>detection off`;
    } else if (s.error) {
      el.className = 'status error';
      el.innerHTML = `<span class="dot"></span>${s.error}`;
    } else if (s.running) {
      el.className = 'status live';
      const n = s.last_detection_count;
      el.innerHTML = `<span class="dot"></span>live · ${s.source} · ${s.model} · ${s.fps} fps · ${n} object${n === 1 ? '' : 's'} in frame`;
    } else {
      el.className = 'status';
      el.innerHTML = `<span class="dot"></span>starting camera…`;
    }
  } catch (e) {
    $('status').className = 'status error';
    $('status').textContent = 'server unreachable';
  }
}

// --- labels (populate filters + datalist) ----------------------------------
async function loadLabels() {
  const labels = await api('/api/labels');
  const sel = $('search-label');
  const dl = $('label-options');
  const liveChips = $('live-detections');
  sel.innerHTML = '<option value="">any</option>';
  dl.innerHTML = '';
  liveChips.innerHTML = '';
  for (const l of labels) {
    sel.insertAdjacentHTML('beforeend', `<option value="${l.label}">${l.label} (${l.n})</option>`);
    dl.insertAdjacentHTML('beforeend', `<option value="${l.label}">`);
    liveChips.insertAdjacentHTML('beforeend',
      `<span class="chip">${l.label} · ${l.n}</span>`);
  }
  if (typeof syncGalleryFilter === 'function') syncGalleryFilter();
}

// --- alerts ----------------------------------------------------------------
let lastAlertTs = 0;
async function pollAlerts() {
  const alerts = await api('/api/alerts?limit=50');
  const list = $('alerts-list');
  if (!alerts.length) { list.textContent = 'No alerts yet.'; return; }
  list.innerHTML = alerts.map(a => `
    <div class="alert-item">
      ${a.snapshot ? `<img src="/snapshots/${a.snapshot}">` : ''}
      <div class="meta">
        <div class="label">${a.message || a.label}</div>
        <div class="muted">${fmt(a.ts)}</div>
      </div>
    </div>`).join('');
  if (alerts[0].ts > lastAlertTs && lastAlertTs > 0) {
    document.title = '(!) Argus — alert!';
    setTimeout(() => document.title = 'Argus', 4000);
  }
  lastAlertTs = alerts[0].ts;
}

// --- rules -----------------------------------------------------------------
async function loadRules() {
  const rules = await api('/api/rules');
  const list = $('rules-list');
  if (!rules.length) { list.innerHTML = '<span class="muted">No rules. Add one above.</span>'; return; }
  list.innerHTML = rules.map(r => {
    const when = (r.start_hour == null || r.end_hour == null)
      ? 'any time' : `${r.start_hour}:00 to ${r.end_hour}:00`;
    return `<div class="rule-item ${r.active ? '' : 'inactive'}">
      <div class="meta">
        <div class="label">${r.label} <span class="badge">conf ≥ ${r.min_conf}</span></div>
        <div class="muted">${when}</div>
      </div>
      <button class="ghost" onclick="toggleRule(${r.id}, ${r.active ? 0 : 1})">${r.active ? 'pause' : 'enable'}</button>
      <button class="ghost" onclick="deleteRule(${r.id})">delete</button>
    </div>`;
  }).join('');
}

async function toggleRule(id, active) {
  await api(`/api/rules/${id}/toggle`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: !!active }),
  });
  loadRules();
}
async function deleteRule(id) {
  await api(`/api/rules/${id}`, { method: 'DELETE' });
  loadRules();
}
window.toggleRule = toggleRule;
window.deleteRule = deleteRule;

$('rule-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    label: $('rule-label').value.trim(),
    min_conf: parseFloat($('rule-conf').value) || 0.5,
    start_hour: $('rule-start').value === '' ? null : parseInt($('rule-start').value),
    end_hour: $('rule-end').value === '' ? null : parseInt($('rule-end').value),
  };
  await api('/api/rules', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  $('rule-form').reset();
  $('rule-conf').value = '0.5';
  loadRules();
});

// --- search ----------------------------------------------------------------
const toEpoch = (v) => v ? new Date(v).getTime() / 1000 : null;
$('search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const params = new URLSearchParams();
  const label = $('search-label').value;
  const start = toEpoch($('search-start').value);
  const end = toEpoch($('search-end').value);
  if (label) params.set('label', label);
  if (start) params.set('start', start);
  if (end) params.set('end', end);
  params.set('limit', '200');
  const rows = await api('/api/detections?' + params.toString());
  const out = $('search-results');
  if (!rows.length) { out.innerHTML = '<span class="muted">No matches.</span>'; return; }
  out.innerHTML = rows.map(r => `
    <div class="result">
      ${r.snapshot ? `<img src="/snapshots/${r.snapshot}">` : '<div class="muted">no snapshot</div>'}
      <div class="label">${r.label}</div>
      <div class="muted">${(r.confidence * 100).toFixed(0)}% · ${fmt(r.ts)}</div>
    </div>`).join('');
});

// --- settings menu (video source) ------------------------------------------
const menuBtn = $('menu-btn'), menuPanel = $('menu-panel');
menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const opening = menuPanel.hidden;
  menuPanel.hidden = !opening;
  if (opening) { loadDevices(); loadSettings(); }
});
document.addEventListener('click', (e) => {
  if (!menuPanel.hidden && !menuPanel.contains(e.target) && e.target !== menuBtn) {
    menuPanel.hidden = true;
  }
});

function updatePowerButton(paused) {
  const btn = $('power-toggle');
  if (!btn) return;
  if (paused) {
    btn.className = 'power off';
    btn.textContent = 'Detection: OFF — click to turn on';
  } else {
    btn.className = 'power on';
    btn.textContent = 'Detection: ON — click to turn off';
  }
  btn.dataset.paused = paused ? '1' : '0';
}
$('power-toggle').addEventListener('click', async () => {
  const turningOn = $('power-toggle').dataset.paused === '1';
  await api('/api/power', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ on: turningOn }),
  });
  if (turningOn) $('stream').src = '/stream?t=' + Date.now();  // reconnect feed
  pollStatus();
});

// --- storage settings ------------------------------------------------------
async function loadSettings() {
  const s = await api('/api/settings');
  $('retention').value = String(s.retention_days);
}
$('retention').addEventListener('change', async () => {
  await api('/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ retention_days: parseInt($('retention').value) }),
  });
  $('cleanup-status').textContent = parseInt($('retention').value) === 0
    ? 'Keeping everything. Pinned snapshots are never deleted.'
    : `Auto-deleting data older than ${$('retention').value} day(s). Pinned items kept forever.`;
});
$('clean-now').addEventListener('click', async () => {
  const btn = $('clean-now'); btn.disabled = true; btn.textContent = 'Cleaning…';
  try {
    const r = await api('/api/cleanup', { method: 'POST' });
    $('cleanup-status').textContent = r.skipped
      ? 'Retention is off — nothing to clean. Set a timeframe above first.'
      : `Removed ${r.detections_deleted || 0} records and ${r.files_deleted || 0} image files.`;
    if (!$('tab-gallery').hidden) loadGallery();
  } finally {
    btn.disabled = false; btn.textContent = 'Clean now';
  }
});

let selectedSource = null;
async function loadDevices() {
  const { devices, current } = await api('/api/devices');
  selectedSource = current;
  const list = $('device-list');
  if (!devices.length) {
    list.innerHTML = '<span class="muted">No cameras detected via system info. Use the custom field below (e.g. 0).</span>';
  } else {
    list.innerHTML = devices.map(d => {
      const val = String(d.index);
      const isCurrent = val === String(current);
      return `<label class="device-opt ${isCurrent ? 'selected' : ''}" data-val="${val}">
        <input type="radio" name="device" value="${val}" ${isCurrent ? 'checked' : ''}>
        <span>${d.name}</span>
        <span class="muted">#${d.index}</span>
        ${isCurrent ? '<span class="current">live</span>' : ''}
      </label>`;
    }).join('');
    list.querySelectorAll('input[name=device]').forEach(r => {
      r.addEventListener('change', () => {
        selectedSource = r.value;
        $('custom-source').value = '';
        list.querySelectorAll('.device-opt').forEach(o =>
          o.classList.toggle('selected', o.dataset.val === r.value));
      });
    });
  }
}

$('rescan').addEventListener('click', () => {
  $('device-list').innerHTML = '<span class="muted">scanning…</span>';
  loadDevices();
});

$('apply-source').addEventListener('click', async () => {
  const custom = $('custom-source').value.trim();
  const source = custom || selectedSource;
  if (!source) return;
  const btn = $('apply-source');
  btn.disabled = true; btn.textContent = 'Switching…';
  try {
    await api('/api/source', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    });
    // reconnect the live stream to the new source
    $('stream').src = '/stream?t=' + Date.now();
    menuPanel.hidden = true;
  } catch (e) {
    alert('Could not switch source: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Switch source';
  }
});

// --- tabs ------------------------------------------------------------------
function activateTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));
  $('tab-' + name).classList.add('active');
  if (name === 'gallery') loadGallery();
}
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});
// keyboard shortcuts: 1 = Dashboard, 2 = Gallery
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;  // don't hijack typing
  if (!$('lightbox').hidden) return;                        // lightbox owns arrows/Esc
  if (e.key === '1') activateTab('dashboard');
  else if (e.key === '2') activateTab('gallery');
});

// --- gallery ---------------------------------------------------------------
let galleryItems = [];   // current gallery list, indexed for lightbox navigation
let galleryView = 'all'; // 'all' | 'pinned'

document.querySelectorAll('.gtab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.gtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    galleryView = btn.dataset.view;
    loadGallery();
  });
});

async function loadGallery() {
  const label = $('gallery-label').value;
  const params = new URLSearchParams();
  if (label) params.set('label', label);
  params.set('limit', '120');
  if (galleryView === 'pinned') params.set('pinned', 'true');
  galleryItems = await api('/api/gallery?' + params.toString());
  const grid = $('gallery-grid');
  if (!galleryItems.length) {
    grid.innerHTML = galleryView === 'pinned'
      ? '<span class="muted">No pinned captures yet. Open any image and click Pin to permanent.</span>'
      : '<span class="muted">No snapshots yet. They appear when objects are detected (saved every couple of seconds).</span>';
    return;
  }
  grid.innerHTML = galleryItems.map((it, i) => `
    <div class="result ${it.kept ? 'kept' : ''}" onclick="showLightbox(${i})">
      ${it.kept ? '<span class="pin-badge">PIN</span>' : ''}
      <button class="del-badge" title="Delete" onclick="deleteSnapshot(event, ${i})">&times;</button>
      <img src="/snapshots/${it.snapshot}" loading="lazy">
      <div class="label">${(it.labels || '').split(',').join(', ')}</div>
      <div class="muted">${fmt(it.ts)}</div>
    </div>`).join('');
}

async function deleteSnapshot(event, i) {
  if (event) event.stopPropagation();      // don't open the lightbox
  const it = galleryItems[i];
  if (!it || !confirm('Delete this capture permanently?')) return;
  await api('/api/snapshot/' + encodeURIComponent(it.snapshot), { method: 'DELETE' });
  if (!$('lightbox').hidden) closeLightbox();
  loadGallery();
}
window.deleteSnapshot = deleteSnapshot;

function syncGalleryFilter() {
  // mirror the detection labels into the gallery filter dropdown
  const src = $('search-label');
  const dst = $('gallery-label');
  const cur = dst.value;
  dst.innerHTML = src.innerHTML.replace('>any<', '>all<');
  dst.value = cur;
}

let lightboxIndex = -1;
function showLightbox(i) {
  if (i < 0 || i >= galleryItems.length) return;
  lightboxIndex = i;
  const it = galleryItems[i];
  $('lightbox-img').src = '/snapshots/' + it.snapshot;
  $('lightbox-caption').innerHTML =
    `${it.kept ? '<b style="color:var(--accent)">PINNED</b> · ' : ''}` +
    `${(it.labels || '').split(',').join(', ')} · ${fmt(it.ts)} · ${i + 1}/${galleryItems.length}`;
  $('lightbox-img').classList.toggle('kept-img', !!it.kept);
  // wire the controls to this image
  $('lb-download').href = '/snapshots/' + it.snapshot + '?download=1';
  updatePinButton(it.kept);
  $('lightbox').hidden = false;
}

function updatePinButton(kept) {
  const btn = $('lb-pin');
  btn.classList.toggle('pinned', !!kept);
  btn.textContent = kept ? 'Pinned — click to unpin' : 'Pin to permanent';
}

$('lb-pin').addEventListener('click', async () => {
  const it = galleryItems[lightboxIndex];
  if (!it) return;
  const newKept = !it.kept;
  await api('/api/keep', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshot: it.snapshot, kept: newKept }),
  });
  it.kept = newKept ? 1 : 0;
  updatePinButton(it.kept);
  loadGallery();   // refresh badges underneath (keeps current order)
});

$('lb-delete').addEventListener('click', () => deleteSnapshot(null, lightboxIndex));
function moveLightbox(delta) {
  if ($('lightbox').hidden) return;
  const next = lightboxIndex + delta;
  if (next >= 0 && next < galleryItems.length) showLightbox(next);
}
function closeLightbox() { $('lightbox').hidden = true; lightboxIndex = -1; }
window.showLightbox = showLightbox;

$('lightbox').addEventListener('click', closeLightbox);
$('lightbox-img').addEventListener('click', e => e.stopPropagation());  // clicking the image won't close
document.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
document.addEventListener('keydown', e => {
  if ($('lightbox').hidden) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowRight') moveLightbox(1);
  else if (e.key === 'ArrowLeft') moveLightbox(-1);
});

$('gallery-form').addEventListener('submit', e => { e.preventDefault(); loadGallery(); });
$('gallery-refresh').addEventListener('click', loadGallery);

// --- boot ------------------------------------------------------------------
pollStatus(); loadLabels().then(syncGalleryFilter); pollAlerts(); loadRules();
setInterval(pollStatus, 2000);
setInterval(pollAlerts, 3000);
setInterval(loadLabels, 10000);
