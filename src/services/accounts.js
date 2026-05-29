// Akun storage: simpan storageState + metadata di accounts/<email>.json,
// plus master file accounts/emails.txt. Juga punya util buat ZIP & list.
import archiver from "archiver";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ACCOUNTS_DIR } from "./config.js";

export const EMAILS_FILE = join(ACCOUNTS_DIR, "emails.txt");

// Scan folder accounts/ → list { email, createdAt, file } untuk semua *.json
export async function scanAccounts() {
  let files;
  try {
    files = await readdir(ACCOUNTS_DIR);
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".json") || f.startsWith("_") || f === "emails.json") continue;
    const filePath = join(ACCOUNTS_DIR, f);
    try {
      const raw = await readFile(filePath, "utf8");
      const data = JSON.parse(raw);
      const fileStat = await stat(filePath);
      if (data.email) {
        out.push({
          email: data.email,
          createdAt: data.createdAt ?? fileStat.mtime.toISOString(),
          file: filePath,
          credits: data.credits ?? null,
          leonardoUserId: data.leonardoUserId ?? null,
        });
      }
    } catch {
      // file rusak / bukan format akun → skip diam-diam
    }
  }
  return out;
}

// Save 1 akun ke accounts/<email>.json. Override kalau udah ada.
export async function saveAccount(record) {
  if (!record?.email) throw new Error("saveAccount: email kosong");
  await mkdir(ACCOUNTS_DIR, { recursive: true });
  const filePath = join(ACCOUNTS_DIR, `${record.email}.json`);
  const payload = {
    createdAt: new Date().toISOString(),
    ...record,
  };
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

// Load 1 akun by email
export async function loadAccount(email) {
  const filePath = join(ACCOUNTS_DIR, `${email}.json`);
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

// Update credits/userId/etc tanpa hilangin storageState
export async function patchAccount(email, patch) {
  const existing = (await loadAccount(email)) || { email };
  const merged = { ...existing, ...patch, email };
  return saveAccount(merged);
}

// Tulis ulang emails.txt dari hasil scan + records baru. Dedup, sort terbaru-dulu.
export async function rebuildEmailsFile(extraRecords = []) {
  const all = await scanAccounts();
  const map = new Map(all.map((r) => [r.email, r]));
  for (const rec of extraRecords) {
    if (rec?.email) {
      map.set(rec.email, { email: rec.email, createdAt: rec.createdAt });
    }
  }
  const sorted = [...map.values()].sort((a, b) =>
    (b.createdAt || "").localeCompare(a.createdAt || "")
  );
  await mkdir(ACCOUNTS_DIR, { recursive: true });
  const lines = [
    `# Daftar email akun Canva + Leonardo`,
    `# Total: ${sorted.length}  ·  Updated: ${new Date().toISOString()}`,
    `# Login: paste email di canva.com/login, OTP-nya cek di Hubify`,
    "",
    ...sorted.map((r) => r.email),
  ];
  await writeFile(EMAILS_FILE, lines.join("\n"), "utf8");
  return sorted;
}

// ZIP folder accounts/ → simpan di destPath. Return ukuran file.
export async function zipAccounts(destPath) {
  await mkdir(ACCOUNTS_DIR, { recursive: true });
  return new Promise((resolve, reject) => {
    const output = createWriteStream(destPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve(archive.pointer()));
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(ACCOUNTS_DIR, "accounts");
    archive.finalize();
  });
}

// Pretty-print 1 record akun (untuk /list)
export function formatAccountLine(rec) {
  const credits = rec.credits != null ? ` — ${rec.credits} credit` : "";
  return `• ${rec.email}${credits}`;
}
