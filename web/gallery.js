// Gallery (grouped by object) and the lightbox (overlay boxes, toggle, nav, swipe).
import { $, fmt, api, postJSON } from './api.js';

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

export async function loadGallery() {
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

export function syncGalleryFilter() {
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
  await postJSON('/api/keep', { snapshot: it.snapshot, kept: newKept });
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
