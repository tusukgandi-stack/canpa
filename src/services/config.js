// Config loader untuk leobot-telegram. File-based, no DB.
// Project root = folder yang berisi package.json (parent dari src/).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// CONFIG_FILE & ACCOUNTS_DIR bisa di-override lewat env var. Ini dipakai oleh
// smoke test supaya jalan di folder terisolasi — JANGAN pernah nyentuh data
// akun produksi user. Default: di dalam project root.
export const CONFIG_FILE =
  process.env.LEOBOT_CONFIG_FILE || join(PROJECT_ROOT, "config.json");
export const ACCOUNTS_DIR =
  process.env.LEOBOT_ACCOUNTS_DIR || join(PROJECT_ROOT, "accounts");

// Hubify Mail API base — server OTP
export const HUBIFY_API_BASE = "https://mail.hubify.store/api/ext";

// Default config — di-merge dengan file existing tiap loadConfig()
const DEFAULT = {
  // Telegram
  telegramToken: "",
  ownerIds: [],

  // Shared (semua mode)
  apiKey: "",
  // Multi-link Canva Business. Tiap link = 1 tim (maks `canvaSeatLimit` member).
  // Strategi join: fill-then-next (link pertama yang masih ada slot dipakai).
  // Format: [{ url, joined }]. `joined` = estimasi member; di-reconcile oleh
  // /checkseats dari jumlah anggota live di Canva.
  canvaBusinessLinks: [],
  canvaSeatLimit: 100,
  // Akun khusus buat cek sisa seat (harus email Hubify-managed biar OTP fetch).
  checkerEmail: "",
  domainId: null,

  // Browser & runtime
  headless: false,
  proxies: [],
  concurrency: 3,
  deleteInboxAfter: false,

  // Toggle per-mode
  modes: {
    generate: { enableLeonardo: true },
    login: { enableLeonardo: false, joinBusiness: true },
  },
};

// Deep-merge sederhana — cuma object-of-primitives, jadi 2 level cukup.
function mergeDefault(parsed) {
  const out = { ...DEFAULT, ...parsed };
  out.modes = {
    generate: { ...DEFAULT.modes.generate, ...(parsed.modes?.generate || {}) },
    login: { ...DEFAULT.modes.login, ...(parsed.modes?.login || {}) },
  };
  // Buang sisa toggle signup lama (signup sekarang Canva-only, no toggle)
  if (out.modes.signup) delete out.modes.signup;
  // Migrasi: kalau dulu pake `proxy` (string), pindah ke `proxies` (array)
  if (typeof parsed.proxy === "string") {
    if (parsed.proxy.trim()) out.proxies = [parsed.proxy.trim()];
    delete out.proxy;
  }
  // Normalisasi canvaBusinessLinks → array of { url, joined }.
  out.canvaBusinessLinks = normalizeLinks(out.canvaBusinessLinks);
  // Migrasi: field lama `canvaBusinessUrl` (string tunggal) → masuk ke array.
  if (typeof parsed.canvaBusinessUrl === "string" && parsed.canvaBusinessUrl.trim()) {
    const url = parsed.canvaBusinessUrl.trim();
    if (!out.canvaBusinessLinks.some((l) => l.url === url)) {
      out.canvaBusinessLinks.unshift({ url, joined: 0 });
    }
  }
  delete out.canvaBusinessUrl;
  // Seat limit harus angka positif (default 100).
  const lim = parseInt(out.canvaSeatLimit, 10);
  out.canvaSeatLimit = Number.isFinite(lim) && lim > 0 ? lim : 100;
  out.checkerEmail = (out.checkerEmail || "").trim();
  return out;
}

// Terima berbagai bentuk input (array of string / array of object / undefined)
// → array of { url, joined:number }. Buang yang ga ada url-nya.
function normalizeLinks(links) {
  if (!Array.isArray(links)) return [];
  const out = [];
  for (const l of links) {
    if (typeof l === "string") {
      const url = l.trim();
      if (url) out.push({ url, joined: 0 });
    } else if (l && typeof l.url === "string" && l.url.trim()) {
      const joined = parseInt(l.joined, 10);
      out.push({ url: l.url.trim(), joined: Number.isFinite(joined) && joined > 0 ? joined : 0 });
    }
  }
  return out;
}

export async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_FILE, "utf8");
    return mergeDefault(JSON.parse(raw));
  } catch {
    return { ...DEFAULT, modes: { ...DEFAULT.modes } };
  }
}

export async function saveConfig(cfg) {
  await mkdir(PROJECT_ROOT, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
}

// Convenience: load → mutate → save dalam 1 panggilan
export async function updateConfig(mutator) {
  const cfg = await loadConfig();
  await mutator(cfg);
  await saveConfig(cfg);
  return cfg;
}

export { PROJECT_ROOT, DEFAULT as DEFAULT_CONFIG };
