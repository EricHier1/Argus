// Dashboard widgets: detection labels, alerts feed, alert rules, search, activity.
import { $, fmt, api, postJSON, toEpoch } from './api.js';
import { syncGalleryFilter } from './gallery.js';

// --- labels (populate filters + datalist) ----------------------------------
export async function loadLabels() {
  const labels = await api('/api/labels');
  const sel = $('search-label'), dl = $('label-options'), liveChips = $('live-detections');
  sel.innerHTML = '<option value="">any</option>';
  dl.innerHTML = '';
  liveChips.innerHTML = '';
  for (const l of labels) {
    sel.insertAdjacentHTML('beforeend', `<option value="${l.label}">${l.label} (${l.n})</option>`);
    dl.insertAdjacentHTML('beforeend', `<option value="${l.label}">`);
    liveChips.insertAdjacentHTML('beforeend', `<span class="chip">${l.label} · ${l.n}</span>`);
  }
  syncGalleryFilter();
}

// --- alerts ----------------------------------------------------------------
let lastAlertTs = 0;
export async function pollAlerts() {
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
export async function loadRules() {
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
  await postJSON(`/api/rules/${id}/toggle`, { active: !!active });
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
  await postJSON('/api/rules', {
    label: $('rule-label').value.trim(),
    min_conf: parseFloat($('rule-conf').value) || 0.5,
    start_hour: $('rule-start').value === '' ? null : parseInt($('rule-start').value),
    end_hour: $('rule-end').value === '' ? null : parseInt($('rule-end').value),
  });
  $('rule-form').reset();
  $('rule-conf').value = '0.5';
  loadRules();
});

// --- search ----------------------------------------------------------------
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

// --- activity timeline ------------------------------------------------------
export async function loadActivity() {
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
