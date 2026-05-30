// Multi-link Canva Business helper.
//   - Tiap link = 1 tim, kapasitas `seatLimit` member (default 100).
//   - Strategi: FILL-THEN-NEXT. Link pertama yang masih ada slot dipakai dulu
//     sampai penuh, baru pindah ke link berikutnya.
//   - `joined` di config = estimasi member (di-reconcile akurat oleh /checkseats).
//
// Dipakai generate.js & login.js: assignLinks() di awal job buat nentuin akun
// ke-i join link mana, terus commitJoins() di akhir job buat nambah counter
// (1x tulis config, hindari race antar worker paralel).
import { updateConfig } from "./config.js";

// Sisa slot tiap link. Return array of { url, joined, remaining }.
export function linkCapacity(links, seatLimit) {
  return (links || []).map((l) => ({
    url: l.url,
    joined: l.joined || 0,
    remaining: Math.max(0, seatLimit - (l.joined || 0)),
  }));
}

// Total sisa slot lintas semua link.
export function totalRemaining(links, seatLimit) {
  return linkCapacity(links, seatLimit).reduce((s, l) => s + l.remaining, 0);
}

// Assign `count` akun ke link pakai fill-then-next.
// Return array sepanjang `count` berisi url (string) atau null (kalau slot habis).
// Reservasi dihitung in-memory supaya banyak akun dalam 1 batch ga over-assign
// ke link yang sama.
export function assignLinks(links, seatLimit, count) {
  const cap = linkCapacity(links, seatLimit);
  const out = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    // Maju ke link berikutnya yang masih punya slot.
    while (cursor < cap.length && cap[cursor].remaining <= 0) cursor++;
    if (cursor >= cap.length) {
      out.push(null); // semua link penuh
      continue;
    }
    out.push(cap[cursor].url);
    cap[cursor].remaining--;
  }
  return out;
}

// Tambah counter `joined` per-url ke config (1x tulis). `counts` = { url: n }.
export async function commitJoins(counts) {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  if (!entries.length) return;
  await updateConfig((c) => {
    c.canvaBusinessLinks = c.canvaBusinessLinks || [];
    for (const [url, n] of entries) {
      const link = c.canvaBusinessLinks.find((l) => l.url === url);
      if (link) link.joined = (link.joined || 0) + n;
    }
  });
}

// Set `joined` akurat per-url (dipakai /checkseats buat reconcile dari live count).
// `counts` = { url: memberCount }.
export async function reconcileJoins(counts) {
  const entries = Object.entries(counts);
  if (!entries.length) return;
  await updateConfig((c) => {
    c.canvaBusinessLinks = c.canvaBusinessLinks || [];
    for (const [url, n] of entries) {
      const link = c.canvaBusinessLinks.find((l) => l.url === url);
      if (link && Number.isFinite(n)) link.joined = n;
    }
  });
}
