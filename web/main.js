// Entry point: wires tabs + keyboard shortcuts and boots the polling loops.
// Importing the feature modules runs their event-listener setup as a side effect.
import { $ } from './api.js';
import { pollStatus } from './feeds.js';
import { loadLabels, pollAlerts, loadRules, loadActivity, loadAlertsTab } from './dashboard.js';
import { loadGallery } from './gallery.js';
import { loadAnalytics } from './analytics.js';
import './menu.js';

// --- tabs ------------------------------------------------------------------
function activateTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));
  $('tab-' + name).classList.add('active');
  if (name === 'gallery') loadGallery();
  else if (name === 'alerts') loadAlertsTab();
  else if (name === 'analytics') loadAnalytics();
}
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});
// keyboard shortcuts: 1 Dashboard · 2 Gallery · 3 Alerts · 4 Analytics
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;  // don't hijack typing
  if (!$('lightbox').hidden) return;                        // lightbox owns arrows/Esc
  const map = { '1': 'dashboard', '2': 'gallery', '3': 'alerts', '4': 'analytics' };
  if (map[e.key]) activateTab(map[e.key]);
});

// --- boot ------------------------------------------------------------------
pollStatus(); loadLabels(); pollAlerts(); loadRules(); loadActivity();
setInterval(pollStatus, 2000);
setInterval(pollAlerts, 3000);
setInterval(loadLabels, 10000);
setInterval(loadActivity, 30000);
