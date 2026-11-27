// Safe JSON handling for untrusted input (plan imports, backups).
// JSON only: no eval, no revivers that execute code, prototype-pollution keys rejected,
// size and depth bounded before expensive processing.

export const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export class SafeJsonError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function byteLength(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  return text.length * 3;
}

/**
 * @param {string} text
 * @param {{maxBytes:number, maxDepth:number}} limits
 * @returns {any}
 */
export function parseJsonSafe(text, { maxBytes, maxDepth }) {
  if (typeof text !== 'string') throw new SafeJsonError('not-text', 'התוכן אינו טקסט');
  const trimmed = text.replace(/^﻿/, '').trim();
  if (!trimmed) throw new SafeJsonError('empty', 'לא הוזן תוכן');
  if (byteLength(trimmed) > maxBytes) throw new SafeJsonError('too-large', `הקובץ גדול מדי (מעל ${Math.round(maxBytes / 1024)} KB)`);
  let value;
  try {
    value = JSON.parse(trimmed);
  } catch (e) {
    throw new SafeJsonError('syntax', 'התוכן אינו JSON תקין' + (e && e.message ? ` (${e.message})` : ''));
  }
  checkTree(value, maxDepth);
  return value;
}

function checkTree(root, maxDepth) {
  const stack = [[root, 0]];
  while (stack.length) {
    const [v, d] = stack.pop();
    if (d > maxDepth) throw new SafeJsonError('too-deep', 'מבנה ה-JSON עמוק מדי');
    if (v && typeof v === 'object') {
      if (Array.isArray(v)) { for (const x of v) stack.push([x, d + 1]); continue; }
      for (const k of Object.keys(v)) {
        if (FORBIDDEN_KEYS.has(k)) throw new SafeJsonError('forbidden-key', `שדה אסור בקובץ: ${k}`);
        stack.push([v[k], d + 1]);
      }
    }
  }
}

export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** Deterministic canonical JSON (sorted keys) for fingerprinting. */
export function canonicalJson(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}

/** cyrb53-based 106-bit hex hash; deterministic, synchronous, not cryptographic. */
export function hashString(str) {
  const run = (seed) => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  };
  return run(0) + run(0x9e3779b9);
}

export const fingerprint = (v) => hashString(canonicalJson(v));
