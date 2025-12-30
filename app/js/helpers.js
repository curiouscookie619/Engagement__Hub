import { RETRY_DELAYS } from './constants.js';

export function formatTs(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  return d.toLocaleString();
}

export function validateMobile(v) {
  if (!v) return false;
  const cleaned = v.replace(/\+91|\s|-/g, "");
  return /^\d{10}$/.test(cleaned);
}
export function cleanMobile(v) {
  return v.replace(/\+91|\s|-/g, "");
}

export function validatePan(v) {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v || "");
}

export function validateEmail(v) {
  if (!v) return true;
  return /.+@.+\..+/.test(v);
}

export function nextRetryTime(attempt) {
  const delay = RETRY_DELAYS[attempt] || null;
  if (!delay) return null;
  return new Date(Date.now() + delay * 1000).toISOString();
}

export function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

export function randomId(prefix = "evt") {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
