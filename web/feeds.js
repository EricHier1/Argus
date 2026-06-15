// Live camera feeds, status bar, and the power / boxes toggles.
import { $, api, postJSON } from './api.js';

let renderedSources = null;   // null forces the first render even with 0 cameras

export function forceFeedRebuild() { renderedSources = null; }

export async function pollStatus() {
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

export function reloadFeeds() {
  $('feed-grid').querySelectorAll('img').forEach(img => {
    const u = new URL(img.src, location.href);
    u.searchParams.set('t', Date.now());
    img.src = u.toString();
  });
}

// --- boxes toggle (live feed) ----------------------------------------------
function updateBoxesButton(on) {
  const btn = $('boxes-toggle');
  if (!btn) return;
  btn.textContent = 'Boxes: ' + (on ? 'ON' : 'OFF');
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.dataset.on = on ? '1' : '0';
}
$('boxes-toggle').addEventListener('click', async () => {
  const on = $('boxes-toggle').dataset.on !== '0';
  const r = await postJSON('/api/boxes', { on: !on });
  updateBoxesButton(r.show_boxes);
});

// --- power toggle (double-click to confirm) --------------------------------
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
  await postJSON('/api/power', { on: turningOn });   // no source = all cameras
  if (turningOn) reloadFeeds();
  pollStatus();
});
