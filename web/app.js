const $ = (id) => document.getElementById(id);
const fmt = (ts) => new Date(ts * 1000).toLocaleString();
async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// --- status + live feeds (multi-camera) ------------------------------------
let renderedSources = null;   // null forces the first render even with 0 cameras
async function pollStatus() {
  try {
    const s = await api('/api/status');
    const cameras = s.cameras || [];
    renderFeeds(cameras);
    updateStatusBar(cameras);
    updatePowerButton(cameras.length > 0 && cameras.every(c => c.paused));
    updateBoxesButton(s.show_boxes !== false);
  } catch (e) {
    $('status').className = 'status error';
    $('status').textContent = 'server unreachable';
  }
}

function updateBoxesButton(on) {
  const btn = $('boxes-toggle');
  if (!btn) return;
  btn.textContent = 'Boxes: ' + (on ? 'ON' : 'OFF');
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.dataset.on = on ? '1' : '0';
}
$('boxes-toggle').addEventListener('click', async () => {
  const on = $('boxes-toggle').dataset.on !== '0';
  const r = await api('/api/boxes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ on: !on }),
  });
  updateBoxesButton(r.show_boxes);
});

function renderFeeds(cameras) {
  const grid = $('feed-grid');
  grid.classList.toggle('multi', cameras.length > 1);
  // Only rebuild <img> elements when the set of sources changes, so existing
  // MJPEG streams aren't torn down on every poll.
  const key = cameras.map(c => c.source).join('|');
  if (key !== renderedSources) {
    renderedSources = key;
    grid.innerHTML = cameras.length ? cameras.map(c => `
      <div class="feed-card">
        <div class="feed-video"><img src="/stream?source=${encodeURIComponent(c.source)}" alt="camera ${c.source}"></div>
        <div class="feed-cap"><span class="feed-name">cam ${c.source}</span><span class="feed-stat muted"></span></div>
      </div>`).join('')
      : '<span class="muted">No cameras. Add one from the settings menu.</span>';
  }
  const cards = grid.querySelectorAll('.feed-card');
  cameras.forEach((c, i) => {
    const stat = cards[i] && cards[i].querySelector('.feed-stat');
    if (!stat) return;
    stat.textContent = c.error ? 'error' : c.paused ? 'paused'
      : `${c.fps} fps · ${c.last_detection_count} obj · ${c.device}`;
    stat.className = 'feed-stat ' + (c.error ? 'err' : 'muted');
  });
}

function updateStatusBar(cameras) {
  const el = $('status');
  if (!cameras.length) {
    el.className = 'status'; el.innerHTML = '<span class="dot"></span>no cameras — add one in settings';
    return;
  }
  const err = cameras.find(c => c.error);
  if (err) { el.className = 'status error'; el.innerHTML = `<span class="dot"></span>${err.error}`; return; }
  if (cameras.every(c => c.paused)) {
    el.className = 'status'; el.innerHTML = '<span class="dot"></span>detection off';
    return;
  }
  const live = cameras.filter(c => c.running).length;
  const objs = cameras.reduce((a, c) => a + (c.last_detection_count || 0), 0);
  el.className = 'status live';
  el.innerHTML = `<span class="dot"></span>${live}/${cameras.length} cam live · ${cameras[0].device} · ${objs} object${objs === 1 ? '' : 's'} in frame`;
}

function reloadFeeds() {
  $('feed-grid').querySelectorAll('img').forEach(img => {
    const u = new URL(img.src, location.href);
    u.searchParams.set('t', Date.now());
    img.src = u.toString();
  });
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
function setMenu(open) {
  menuPanel.hidden = !open;
  menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) { loadCameras(); loadSettings(); }
}
menuBtn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(menuPanel.hidden); });
document.addEventListener('click', (e) => {
  if (!menuPanel.hidden && !menuPanel.contains(e.target) && e.target !== menuBtn) setMenu(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !menuPanel.hidden) setMenu(false);   // Esc closes the menu
});

let powerArmed = false, powerArmTimer = null;
function updatePowerButton(paused) {
  const btn = $('power-toggle');
  if (!btn || powerArmed) return;   // don't overwrite the "confirm" label while armed
  btn.className = paused ? 'power off' : 'power on';
  btn.textContent = paused ? 'Detection OFF' : 'Detection ON';
  btn.dataset.paused = paused ? '1' : '0';
}
$('power-toggle').addEventListener('click', async () => {
  const btn = $('power-toggle');
  const turningOn = btn.dataset.paused === '1';
  if (!powerArmed) {                 // first click: arm
    powerArmed = true;
    btn.classList.add('arm');
    btn.textContent = turningOn ? 'Confirm: turn ON' : 'Confirm: turn OFF';
    powerArmTimer = setTimeout(() => { powerArmed = false; btn.classList.remove('arm'); pollStatus(); }, 2500);
    return;
  }
  clearTimeout(powerArmTimer); powerArmed = false; btn.classList.remove('arm');
  await api('/api/power', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ on: turningOn }),   // no source = all cameras
  });
  if (turningOn) reloadFeeds();
  pollStatus();
});

// --- storage settings ------------------------------------------------------
async function loadSettings() {
  const s = await api('/api/settings');
  $('retention').value = String(s.retention_days);
  $('max-snapshots').value = s.max_snapshots ? String(s.max_snapshots) : '';
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
$('max-snapshots').addEventListener('change', async () => {
  await api('/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_snapshots: parseInt($('max-snapshots').value) || 0 }),
  });
});
$('clean-now').addEventListener('click', async () => {
  const btn = $('clean-now'); btn.disabled = true; btn.textContent = 'Cleaning…';
  try {
    const r = await api('/api/cleanup', { method: 'POST' });
    const removed = (r.detections_deleted || 0);
    const files = (r.files_deleted || 0) + (r.count_pruned || 0);
    $('cleanup-status').textContent = `Removed ${removed} records and ${files} image files.`;
    if (!$('tab-gallery').hidden) loadGallery();
  } finally {
    btn.disabled = false; btn.textContent = 'Clean now';
  }
});

// --- camera management ------------------------------------------------------
let selectedSource = null;
async function loadCameras() {
  const { devices, active } = await api('/api/devices');
  const activeSet = new Set(active.map(String));

  // currently-running cameras, each removable
  $('active-cameras').innerHTML = active.length
    ? active.map(s => `<div class="device-opt">
        <span>cam ${s}</span>
        <button class="ghost" onclick="removeCamera('${encodeURIComponent(s)}')">remove</button>
      </div>`).join('')
    : '<span class="muted">No active cameras.</span>';

  // detected devices available to add
  const list = $('device-list');
  if (!devices.length) {
    list.innerHTML = '<span class="muted">No cameras detected automatically. Use the field below (e.g. 0).</span>';
  } else {
    list.innerHTML = devices.map(d => {
      const val = String(d.index);
      const inUse = activeSet.has(val);
      return `<label class="device-opt ${inUse ? 'selected' : ''}" data-val="${val}">
        <input type="radio" name="device" value="${val}" ${inUse ? 'disabled' : ''}>
        <span>${d.name}</span><span class="muted">#${d.index}</span>
        ${inUse ? '<span class="current">added</span>' : ''}
      </label>`;
    }).join('');
    list.querySelectorAll('input[name=device]').forEach(r =>
      r.addEventListener('change', () => { selectedSource = r.value; $('custom-source').value = ''; }));
  }
}

async function addCamera() {
  const source = $('custom-source').value.trim() || selectedSource;
  if (!source) return;
  const btn = $('add-camera'); btn.disabled = true; btn.textContent = 'Adding…';
  try {
    await api('/api/cameras', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    });
    $('custom-source').value = ''; selectedSource = null;
    renderedSources = '';        // force the feed grid to include the new camera
    loadCameras(); pollStatus();
  } catch (e) {
    alert('Could not add camera: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Add camera';
  }
}
async function removeCamera(encSource) {
  await api('/api/cameras/remove', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: decodeURIComponent(encSource) }),
  });
  renderedSources = '';          // force feed grid rebuild
  loadCameras(); pollStatus();
}
window.removeCamera = removeCamera;
$('add-camera').addEventListener('click', addCamera);
$('rescan').addEventListener('click', () => {
  $('device-list').innerHTML = '<span class="muted">scanning…</span>';
  loadCameras();
});

// --- shutdown (double-click to confirm) ------------------------------------
let shutArmed = false, shutTimer = null;
$('shutdown').addEventListener('click', async () => {
  const btn = $('shutdown');
  if (!shutArmed) {
    shutArmed = true;
    btn.classList.add('arm');
    btn.textContent = 'Confirm shutdown';
    shutTimer = setTimeout(() => { shutArmed = false; btn.classList.remove('arm'); btn.textContent = 'Shut down'; }, 2500);
    return;
  }
  clearTimeout(shutTimer); shutArmed = false;
  try { await api('/api/shutdown', { method: 'POST' }); } catch (e) { /* process exits */ }
  document.body.innerHTML =
    '<div style="padding:48px;font:16px/1.6 sans-serif;color:#fff;background:#000;height:100vh">' +
    'Argus has shut down.<br>Restart with <code>.venv/bin/python run.py</code> and reload.</div>';
});

// --- activity timeline ------------------------------------------------------
async function loadActivity() {
  let data;
  try { data = await api('/api/activity?hours=24&buckets=24'); } catch (e) { return; }
  drawActivity(data);
}
function drawActivity(data) {
  const c = $('activity-chart');
  if (!c) return;
  const ctx = c.getContext('2d');
  const w = c.width = c.clientWidth || 600, h = c.height;
  ctx.clearRect(0, 0, w, h);
  const counts = data.counts || [];
  const n = counts.length || 1;
  const max = Math.max(1, ...counts);
  const bw = w / n;
  ctx.fillStyle = '#01BB4E';
  counts.forEach((v, i) => {
    const bh = (v / max) * (h - 18);
    ctx.fillRect(i * bw + 1, h - bh - 14, Math.max(1, bw - 2), bh);
  });
  ctx.fillStyle = '#9CA3AF'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
  const step = Math.max(1, Math.ceil(n / 4));
  for (let i = 0; i < n; i += step) {
    const t = new Date((data.start + i * data.width_s) * 1000);
    ctx.fillText(t.getHours() + ':00', i * bw + bw / 2, h - 2);
  }
}

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

// --- gallery (grouped by object) -------------------------------------------
let galleryGroups = [];    // [{gkey, snapshot, n, labels, ts, kept, source}]
let galleryView = 'all';   // 'all' | 'pinned'

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
  const grid = $('gallery-grid');
  grid.innerHTML = '<span class="muted">Loading…</span>';
  try {
    galleryGroups = await api('/api/gallery?' + params.toString());
  } catch (e) { grid.innerHTML = '<span class="muted">Could not load gallery.</span>'; return; }
  if (!galleryGroups.length) {
    grid.innerHTML = galleryView === 'pinned'
      ? '<span class="muted">No pinned captures yet. Open an object and tap Pin.</span>'
      : '<span class="muted">No captures yet. Objects you detect will appear here.</span>';
    return;
  }
  grid.innerHTML = galleryGroups.map((g, i) => `
    <div class="result ${g.kept ? 'kept' : ''} ${g.n > 1 ? 'stack' : ''}" onclick="openGroup(${i})"
         tabindex="0" role="button" aria-label="${(g.labels || 'object')}, ${g.n} picture${g.n === 1 ? '' : 's'}">
      ${g.kept ? '<span class="pin-badge">PIN</span>' : ''}
      ${g.n > 1 ? `<span class="count-badge">${g.n}</span>` : ''}
      <button class="del-badge" title="Delete object" onclick="deleteGroup(event, ${i})" aria-label="Delete">&times;</button>
      <img src="/snapshots/${g.snapshot}" loading="lazy" alt="">
      <div class="label">${(g.labels || '').split(',').join(', ')}</div>
      <div class="muted">${fmt(g.ts)}${g.n > 1 ? ' · ' + g.n + ' pics' : ''}</div>
    </div>`).join('');
}

async function openGroup(i) {
  const g = galleryGroups[i];
  if (!g) return;
  if (g.n > 1) {
    // multi-pic object: browse within this object's pictures
    lbItems = await api('/api/gallery/group?gkey=' + encodeURIComponent(g.gkey));
    showLightboxAt(lbItems.length - 1);   // newest pic of the stack
  } else {
    // single-pic tile: browse across all gallery tiles
    lbItems = galleryGroups.map(x => ({ snapshot: x.snapshot, ts: x.ts, labels: x.labels, kept: x.kept }));
    showLightboxAt(i);
  }
}
window.openGroup = openGroup;

async function deleteGroup(event, i) {
  if (event) event.stopPropagation();
  const g = galleryGroups[i];
  if (!g) return;
  const msg = g.n > 1 ? `Delete all ${g.n} pictures of this object?` : 'Delete this capture?';
  if (!confirm(msg)) return;
  await api('/api/gallery/group?gkey=' + encodeURIComponent(g.gkey), { method: 'DELETE' });
  loadGallery();
}
window.deleteGroup = deleteGroup;

function syncGalleryFilter() {
  const src = $('search-label'), dst = $('gallery-label'), cur = dst.value;
  dst.innerHTML = src.innerHTML.replace('>any<', '>all<');
  dst.value = cur;
}

// --- lightbox (overlay boxes, toggle, prev/next, swipe) ---------------------
let lbItems = [], lbIndex = -1;
let boxesOn = localStorage.getItem('argusBoxes') !== '0';   // default ON, remembered
const lbBoxCache = {};   // snapshot -> boxes array

function showLightboxAt(j) {
  if (j < 0 || j >= lbItems.length) return;
  lbIndex = j;
  const it = lbItems[j];
  const img = $('lightbox-img');
  img.onload = () => drawOverlay(it.snapshot);
  img.src = '/snapshots/' + it.snapshot;
  img.classList.toggle('kept-img', !!it.kept);
  $('lightbox-caption').innerHTML =
    `${it.kept ? '<b style="color:var(--green)">PINNED</b> · ' : ''}` +
    `${(it.labels || '').split(',').join(', ')} · ${fmt(it.ts)} · ${j + 1}/${lbItems.length}`;
  $('lb-download').href = '/snapshots/' + it.snapshot + '?download=1';
  updatePinButton(it.kept);
  updateBoxesToggle();
  const multi = lbItems.length > 1;
  $('lb-prev').hidden = !multi;
  $('lb-next').hidden = !multi;
  $('lightbox').hidden = false;
}

async function drawOverlay(snapshot) {
  const img = $('lightbox-img'), canvas = $('lightbox-canvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width = img.clientWidth, h = canvas.height = img.clientHeight;
  ctx.clearRect(0, 0, w, h);
  if (!boxesOn || !img.naturalWidth) return;
  let boxes = lbBoxCache[snapshot];
  if (boxes === undefined) {
    try { boxes = await api('/api/snapshot-boxes?name=' + encodeURIComponent(snapshot)); }
    catch (e) { boxes = []; }
    lbBoxCache[snapshot] = boxes;
  }
  if (snapshot !== (lbItems[lbIndex] || {}).snapshot) return;   // navigated away
  const sx = w / img.naturalWidth, sy = h / img.naturalHeight;
  ctx.lineWidth = 2; ctx.font = '600 13px sans-serif'; ctx.textBaseline = 'bottom';
  for (const b of boxes) {
    const col = b.conf >= 0.75 ? '#01BB4E' : b.conf >= 0.5 ? '#F2DF32' : '#F86660';
    const x = b.x1 * sx, y = b.y1 * sy, bw = (b.x2 - b.x1) * sx, bh = (b.y2 - b.y1) * sy;
    ctx.strokeStyle = col; ctx.strokeRect(x, y, bw, bh);
    const tag = `${b.label} ${Math.round(b.conf * 100)}%`;
    const tw = ctx.measureText(tag).width + 8;
    ctx.fillStyle = col; ctx.fillRect(x, Math.max(0, y - 16), tw, 16);
    ctx.fillStyle = '#04200F'; ctx.fillText(tag, x + 4, Math.max(14, y - 2));
  }
}

function updateBoxesToggle() {
  const btn = $('lb-boxes');
  btn.textContent = 'Boxes: ' + (boxesOn ? 'ON' : 'OFF');
  btn.classList.toggle('pinned', boxesOn);   // green when on
}
$('lb-boxes').addEventListener('click', () => {
  boxesOn = !boxesOn;
  localStorage.setItem('argusBoxes', boxesOn ? '1' : '0');
  updateBoxesToggle();
  if (lbItems[lbIndex]) drawOverlay(lbItems[lbIndex].snapshot);
});

function updatePinButton(kept) {
  const btn = $('lb-pin');
  btn.classList.toggle('pinned', !!kept);
  btn.textContent = kept ? 'Pinned' : 'Pin';
}
$('lb-pin').addEventListener('click', async () => {
  const it = lbItems[lbIndex];
  if (!it) return;
  const newKept = !it.kept;
  await api('/api/keep', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshot: it.snapshot, kept: newKept }),
  });
  it.kept = newKept ? 1 : 0;
  updatePinButton(it.kept);
  loadGallery();
});
$('lb-delete').addEventListener('click', async () => {
  const it = lbItems[lbIndex];
  if (!it || !confirm('Delete this picture?')) return;
  await api('/api/snapshot/' + encodeURIComponent(it.snapshot), { method: 'DELETE' });
  lbItems.splice(lbIndex, 1);
  loadGallery();
  if (!lbItems.length) closeLightbox();
  else showLightboxAt(Math.min(lbIndex, lbItems.length - 1));
});
function moveLightbox(delta) {
  if ($('lightbox').hidden) return;
  const next = lbIndex + delta;
  if (next >= 0 && next < lbItems.length) showLightboxAt(next);
}
function closeLightbox() { $('lightbox').hidden = true; lbIndex = -1; lbItems = []; }

$('lb-prev').addEventListener('click', e => { e.stopPropagation(); moveLightbox(-1); });
$('lb-next').addEventListener('click', e => { e.stopPropagation(); moveLightbox(1); });
$('lightbox').addEventListener('click', closeLightbox);            // tap backdrop closes
document.querySelector('.lightbox-stage').addEventListener('click', e => e.stopPropagation());
document.querySelector('.lightbox-controls').addEventListener('click', e => e.stopPropagation());
document.querySelector('.lightbox-close').addEventListener('click', closeLightbox);

// swipe left/right to change pictures (mobile)
let touchX = null, touchY = null;
const stage = document.querySelector('.lightbox-stage');
stage.addEventListener('touchstart', e => { const t = e.changedTouches[0]; touchX = t.clientX; touchY = t.clientY; }, { passive: true });
stage.addEventListener('touchend', e => {
  if (touchX === null) return;
  const t = e.changedTouches[0], dx = t.clientX - touchX, dy = t.clientY - touchY;
  touchX = null;
  if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) moveLightbox(dx < 0 ? 1 : -1);
}, { passive: true });

document.addEventListener('keydown', e => {
  if ($('lightbox').hidden) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowRight') moveLightbox(1);
  else if (e.key === 'ArrowLeft') moveLightbox(-1);
});
window.addEventListener('resize', () => {
  if (!$('lightbox').hidden && lbItems[lbIndex]) drawOverlay(lbItems[lbIndex].snapshot);
});

$('gallery-form').addEventListener('submit', e => { e.preventDefault(); loadGallery(); });
$('gallery-refresh').addEventListener('click', loadGallery);
// keyboard activation for focused gallery tiles
$('gallery-grid').addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('result')) {
    e.preventDefault(); e.target.click();
  }
});

// --- boot ------------------------------------------------------------------
pollStatus(); loadLabels().then(syncGalleryFilter); pollAlerts(); loadRules(); loadActivity();
setInterval(pollStatus, 2000);
setInterval(pollAlerts, 3000);
setInterval(loadLabels, 10000);
setInterval(loadActivity, 30000);
