// Akun storage: disimpan per kategori di subfolder biar gampang dibedain:
//   accounts/generate/<email>.json   → Canva + Leonardo + credit
//   accounts/signup/<email>.json     → Canva only
//   accounts/login/<email>.json      → login akun existing
// Tiap kategori punya emails.txt sendiri. File lama di root accounts/ tetap
// kebaca (backward compat) dan dikategoriin "uncategorized".
import archiver from "archiver";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ACCOUNTS_DIR } from "./config.js";

export const CATEGORIES = ["generate", "signup", "login"];

function categoryDir(category) {
  return CATEGORIES.includes(category)
    ? join(ACCOUNTS_DIR, category)
    : ACCOUNTS_DIR;
}

// Infer kategori dari isi record (buat file lama di root tanpa folder kategori)
function inferCategory(data) {
  if (data.leonardo || data.leonardoUserId || data.credits) return "generate";
  if (data.loggedInAt || data.joinedBusiness !== undefined) return "login";
  return "signup";
}

// Scan 1 folder → list record. `category` di-tag ke tiap hasil.
async function scanDir(dir, category) {
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".json") || f.startsWith("_") || f === "emails.json") continue;
    const filePath = join(dir, f);
    try {
      const raw = await readFile(filePath, "utf8");
      const data = JSON.parse(raw);
      const fileStat = await stat(filePath);
      if (data.email) {
        out.push({
          email: data.email,
          createdAt: data.createdAt ?? data.loggedInAt ?? fileStat.mtime.toISOString(),
          file: filePath,
          category: category ?? inferCategory(data),
          credits: data.credits ?? null,
          leonardoUserId: data.leonardoUserId ?? null,
          joinedBusiness: data.joinedBusiness ?? null,
        });
      }
    } catch {
      // file rusak / bukan format akun → skip
    }
  }
  return out;
}

// Scan semua kategori + root → list lengkap dengan field `category`.
export async function scanAccounts() {
  const out = [];
  for (const cat of CATEGORIES) {
    out.push(...(await scanDir(categoryDir(cat), cat)));
  }
  // File lama di root (tanpa kategori) — infer dari isi
  out.push(...(await scanDir(ACCOUNTS_DIR, null)));
  return out;
}

// Scan 1 kategori aja
export async function scanCategory(category) {
  return scanDir(categoryDir(category), category);
}

// Save 1 akun ke accounts/<category>/<email>.json. Override kalau udah ada.
export async function saveAccount(record, category) {
  if (!record?.email) throw new Error("saveAccount: email kosong");
  const dir = categoryDir(category);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${record.email}.json`);
  const payload = {
    createdAt: new Date().toISOString(),
    category: CATEGORIES.includes(category) ? category : undefined,
    ...record,
  };
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

// Cari file akun by email di semua kategori + root. Return path atau null.
async function findAccountFile(email) {
  const dirs = [...CATEGORIES.map(categoryDir), ACCOUNTS_DIR];
  for (const dir of dirs) {
    const p = join(dir, `${email}.json`);
    try {
      await stat(p);
      return p;
    } catch {
      /* lanjut */
    }
  }
  return null;
}

// Load 1 akun by email (cari di semua lokasi)
export async function loadAccount(email) {
  const filePath = await findAccountFile(email);
  if (!filePath) return null;
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

// Update field akun tanpa hilangin storageState. Tetap di lokasi/kategori asalnya.
export async function patchAccount(email, patch) {
  const filePath = await findAccountFile(email);
  if (!filePath) return null;
  let existing = {};
  try {
    existing = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    existing = { email };
  }
  const merged = { ...existing, ...patch, email };
  await writeFile(filePath, JSON.stringify(merged, null, 2), "utf8");
  return filePath;
}

// Tulis ulang emails.txt per kategori. Dipanggil setelah job selesai.
// Kalau category null → rebuild semua kategori sekaligus.
export async function rebuildEmailsFile(category = null) {
  const cats = category ? [category] : CATEGORIES;
  for (const cat of cats) {
    const dir = categoryDir(cat);
    const records = await scanDir(dir, cat);
    if (!records.length) continue;
    const sorted = records.sort((a, b) =>
      (b.createdAt || "").localeCompare(a.createdAt || "")
    );
    const lines = [
      `# Akun kategori: ${cat}`,
      `# Total: ${sorted.length}  ·  Updated: ${new Date().toISOString()}`,
      "",
      ...sorted.map((r) => r.email),
    ];
    await writeFile(join(dir, "emails.txt"), lines.join("\n"), "utf8");
  }
}

// ZIP seluruh folder accounts/ (termasuk semua subfolder kategori).
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
