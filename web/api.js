// Shared helpers used across all modules.
export const $ = (id) => document.getElementById(id);
export const fmt = (ts) => new Date(ts * 1000).toLocaleString();
export const toEpoch = (v) => (v ? new Date(v).getTime() / 1000 : null);

export async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// POST JSON convenience wrapper.
export const postJSON = (path, body, method = 'POST') =>
  api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
