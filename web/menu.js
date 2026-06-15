// Settings menu: video source / cameras, storage cleanup, and server shutdown.
import { $, api, postJSON } from './api.js';
import { pollStatus, forceFeedRebuild } from './feeds.js';
import { loadGallery } from './gallery.js';

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

// --- storage settings ------------------------------------------------------
async function loadSettings() {
  const s = await api('/api/settings');
  $('retention').value = String(s.retention_days);
  $('max-snapshots').value = s.max_snapshots ? String(s.max_snapshots) : '';
}
$('retention').addEventListener('change', async () => {
  await postJSON('/api/settings', { retention_days: parseInt($('retention').value) });
  $('cleanup-status').textContent = parseInt($('retention').value) === 0
    ? 'Keeping everything. Pinned snapshots are never deleted.'
    : `Auto-deleting data older than ${$('retention').value} day(s). Pinned items kept forever.`;
});
$('max-snapshots').addEventListener('change', async () => {
  await postJSON('/api/settings', { max_snapshots: parseInt($('max-snapshots').value) || 0 });
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

  $('active-cameras').innerHTML = active.length
    ? active.map(s => `<div class="device-opt">
        <span>cam ${s}</span>
        <button class="ghost" onclick="removeCamera('${encodeURIComponent(s)}')">remove</button>
      </div>`).join('')
    : '<span class="muted">No active cameras.</span>';

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
    await postJSON('/api/cameras', { source });
    $('custom-source').value = ''; selectedSource = null;
    forceFeedRebuild();        // include the new camera in the feed grid
    loadCameras(); pollStatus();
  } catch (e) {
    alert('Could not add camera: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Add camera';
  }
}
async function removeCamera(encSource) {
  await postJSON('/api/cameras/remove', { source: decodeURIComponent(encSource) });
  forceFeedRebuild();
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
