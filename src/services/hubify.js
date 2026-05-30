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
//
// `after` (ISO string / Date / null): kalau di-set, OTP yang receivedAt-nya
// <= after DIABAIKAN. Ini penting buat email yang dipakai ulang (login/checker):
// inbox sering masih nyimpen OTP lama dari attempt sebelumnya, dan endpoint /otp
// balikin yang terbaru-yang-ADA — bukan nunggu yang baru. Tanpa filter ini, bot
// bakal narik OTP lama (yg udah invalid) sebelum OTP fresh dari Canva nyampe.
export async function fetchOtp(apiKey, email, opts = {}) {
  const {
    timeoutMs = 90_000,
    intervalMs = 5_000,
    signal,
    after = null,
  } = opts;
  const afterMs = after ? new Date(after).getTime() : null;
  const hasBaseline = afterMs != null && Number.isFinite(afterMs);
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("aborted");
    try {
      const data = await call(apiKey, `/inbox/${encodeURIComponent(email)}/otp`);
      if (data?.otp) {
        // Tolak OTP lama (receivedAt <= baseline). Tunggu yang fresh.
        if (hasBaseline && data.receivedAt) {
          const ts = new Date(data.receivedAt).getTime();
          if (Number.isFinite(ts) && ts <= afterMs) {
            lastErr = null;
            await sleepInterruptible(intervalMs, signal);
            continue;
          }
        }
        return data.otp;
      }
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

// Baseline buat fetchOtp: timestamp (ISO) OTP terbaru yang ADA SEKARANG di
// inbox, atau null kalau belum ada OTP. Panggil SEBELUM trigger kirim OTP baru
// (sebelum submit email) biar OTP fresh nanti dianggap "lebih baru" dari ini.
export async function peekOtpTimestamp(apiKey, email) {
  try {
    const data = await call(apiKey, `/inbox/${encodeURIComponent(email)}/otp`);
    return data?.otp ? data.receivedAt || null : null;
  } catch {
    return null;
  }
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
