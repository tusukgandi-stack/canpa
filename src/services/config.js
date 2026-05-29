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
  canvaBusinessUrl: "",
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
