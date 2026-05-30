// Hubify Mail API client — base URL & auth lewat header X-API-Key.
// Polling OTP punya retry built-in (network error ga langsung bunuh polling).
import { HUBIFY_API_BASE } from "./config.js";

function authHeaders(apiKey) {
  return { "X-API-Key": apiKey, "Content-Type": "application/json" };
}

async function call(apiKey, path, options = {}) {
  if (!apiKey) throw new Error("Hubify API key kosong (set lewat /setapikey)");
  const res = await fetch(`${HUBIFY_API_BASE}${path}`, {
    ...options,
    headers: { ...authHeaders(apiKey), ...(options.headers || {}) },
  });
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Hubify ${res.status}: response bukan JSON`);
  }
  if (!res.ok || body?.success === false) {
    throw new Error(`Hubify ${res.status}: ${body?.error || res.statusText}`);
  }
  return body.data;
}

// Validasi key + ambil daftar domain aktif
export async function listDomains(apiKey) {
  return call(apiKey, "/domains");
}

// Bikin inbox baru. Server pilih random kalau domainId/localPart tidak diisi.
export async function createInbox(apiKey, { domainId, localPart, gender } = {}) {
  const body = {};
  if (domainId) body.domainId = domainId;
  if (localPart) body.localPart = localPart;
  if (gender) body.gender = gender;
  return call(apiKey, "/inbox/create", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// Polling OTP — return string OTP atau null kalau timeout.
// signal (AbortSignal) opsional — kalau abort, throw AbortError langsung.
export async function fetchOtp(apiKey, email, opts = {}) {
  const {
    timeoutMs = 90_000,
    intervalMs = 5_000,
    signal,
  } = opts;
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("aborted");
    try {
      const data = await call(apiKey, `/inbox/${encodeURIComponent(email)}/otp`);
      if (data?.otp) return data.otp;
      lastErr = null;
    } catch (e) {
      lastErr = e;
    }
    // Sleep dengan early-exit kalau abort
    await sleepInterruptible(intervalMs, signal);
  }

  if (lastErr) throw lastErr;
  return null;
}

export async function deleteInbox(apiKey, email) {
  return call(apiKey, `/inbox/${encodeURIComponent(email)}`, { method: "DELETE" });
}

function sleepInterruptible(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    let onAbort;
    const t = setTimeout(() => {
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    onAbort = () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
