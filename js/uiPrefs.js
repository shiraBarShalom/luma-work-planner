// Per-device UI conveniences (selected view modes/filters) in namespaced localStorage.
// Never used for user data; failures are ignored and defaults apply.
import { LS_UI_KEY } from './config.js';

let cache = null;
function read() {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(LS_UI_KEY) || '{}') || {}; } catch { cache = {}; }
  return cache;
}
export function loadUi(key, fallback) {
  const v = read()[key];
  return v === undefined ? fallback : v;
}
export function saveUi(key, value) {
  read()[key] = value;
  try { localStorage.setItem(LS_UI_KEY, JSON.stringify(cache)); } catch { /* storage unavailable: keep in memory */ }
}
