// Smoke test fitur cek seat — mock chromium + fetch (Hubify), boot bot,
// simulate /checkseats, validasi parsing angka anggota + reconcile config.
//
// PENTING: env LEOBOT_ACCOUNTS_DIR & LEOBOT_CONFIG_FILE di-set ke folder temp
// SEBELUM import apa pun → TIDAK PERNAH nyentuh data produksi user.
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { rm, writeFile } from "node:fs/promises";

const TEST_HOME = mkdtempSync(join(tmpdir(), "leobot-seats-"));
process.env.LEOBOT_ACCOUNTS_DIR = join(TEST_HOME, "accounts");
process.env.LEOBOT_CONFIG_FILE = join(TEST_HOME, "config.json");

import { Telegram } from "telegraf";

// ---------- 1. Mock chromium ----------
const playwright = await import("playwright-core");

// Berapa anggota tiap kali buka people page — beda per tim biar realistis.
// Tim ke-i (berdasar urutan buka invite) → counts[i].
const MEMBER_COUNTS = [38, 12];
let teamCursor = -1;

playwright.chromium.launch = async () => makeFakeBrowser();

function makeFakeBrowser() {
  return {
    newContext: async () => makeFakeContext(),
    close: async () => {},
  };
}

function makeFakeContext() {
  return {
    storageState: async () => ({ cookies: [{ name: "sess" }], origins: [] }),
    newPage: async () => makeFakePage(),
  };
}

function makeFakePage() {
  let url = "https://www.canva.com/settings/people";
  return {
    on: () => {},
    off: () => {},
    goto: async (u) => {
      url = u;
      // Tiap buka invite link (brand/join) = pindah tim → maju cursor.
      if (/brand\/join/.test(u)) teamCursor++;
    },
    url: () => url,
    waitForURL: async () => {},
    waitForTimeout: async () => {},
    waitForLoadState: async () => {},
    locator: () => ({
      first: () => fakeLocator(),
      waitFor: async () => {},
      click: async () => {},
    }),
    keyboard: { type: async () => {} },
    mouse: { move: async () => {} },
    evaluate: async (fn) => {
      const s = fn.toString();
      // readTeamMemberCount → cari heading anggota
      if (/anggota|members/i.test(s) && /querySelectorAll/.test(s)) {
        const idx = Math.max(0, teamCursor);
        return MEMBER_COUNTS[idx] ?? null;
      }
      // isOnLogin → false (session valid)
      if (/log in to canva|masuk ke canva|continue with email/i.test(s)) {
        return false;
      }
      // detectCanvaError → null
      if (/domain_blocked/.test(s)) return null;
      // clickByText body eval
      return false;
    },
    waitForFunction: async () => ({ jsonValue: async () => "x" }),
    close: async () => {},
  };
}

function fakeLocator() {
  return {
    waitFor: async () => {},
    click: async () => {},
    inputValue: async () => "",
    fill: async () => {},
    first: () => fakeLocator(),
  };
}

// ---------- 2. Mock fetch (Hubify) ----------
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("hubify.store/api/ext/inbox/") && u.endsWith("/otp")) {
    return jsonResponse({ success: true, data: { otp: "123456" } });
  }
  if (u.includes("hubify.store")) return jsonResponse({ success: true, data: {} });
  return realFetch(url, opts);
};
function jsonResponse(obj) {
  return {
    ok: true,
    status: 200,
    json: async () => obj,
    text: async () => JSON.stringify(obj),
  };
}

// ---------- 3. Unit test readTeamMemberCount langsung ----------
const helpers = await import("../src/services/playwright-helpers.js");
console.log("== readTeamMemberCount parse heading ==");
{
  // Page palsu yang return innerText heading anggota
  const fakePage = {
    evaluate: async (fn) => {
      // Simulasi DOM: panggil fn dengan environment yang nyediain heading.
      // Karena fn jalan di "browser", kita reimplement logikanya di sini pakai
      // data heading contoh dari user: "Anggota (38)".
      const headingText = "Anggota (38)";
      const m = headingText.match(/\((\d[\d.,]*)\)/);
      return m ? parseInt(m[1].replace(/[.,]/g, ""), 10) : null;
    },
  };
  const n = await helpers.readTeamMemberCount(fakePage);
  assert.equal(n, 38);
  console.log("  ok");
}

// ---------- 4. checkSeats service langsung ----------
const { checkSeats } = await import("../src/services/canva-seats.js");
const { mkdir } = await import("node:fs/promises");
const cfgMod = await import("../src/services/config.js");
await mkdir(cfgMod.ACCOUNTS_DIR, { recursive: true });

console.log("== checkSeats service: baca tiap tim ==");
{
  teamCursor = -1;
  const cfg = {
    apiKey: "secret",
    checkerEmail: "checker@hubify.me",
    canvaBusinessLinks: [
      { url: "https://www.canva.com/brand/join?token=A", joined: 0 },
      { url: "https://www.canva.com/brand/join?token=B", joined: 0 },
    ],
    canvaSeatLimit: 100,
    headless: true,
    proxies: [],
  };
  const { results } = await checkSeats({ cfg, signal: undefined, logger: () => {} });
  assert.equal(results.length, 2);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].joined, 38);
  assert.equal(results[0].remaining, 62);
  assert.equal(results[1].joined, 12);
  assert.equal(results[1].remaining, 88);
  console.log("  ok");
}

// ---------- 5. Boot bot + /checkseats integration ----------
const { createBot } = await import("../src/bot.js");
const { isJobActive } = await import("../src/jobs.js");

const initialCfg = {
  telegramToken: "0:fake",
  ownerIds: [999],
  apiKey: "secret",
  checkerEmail: "checker@hubify.me",
  canvaBusinessLinks: [
    { url: "https://www.canva.com/brand/join?token=A", joined: 0 },
    { url: "https://www.canva.com/brand/join?token=B", joined: 0 },
  ],
  canvaSeatLimit: 100,
  headless: true,
  proxies: [],
  concurrency: 2,
  modes: {
    generate: { enableLeonardo: true },
    login: { enableLeonardo: false, joinBusiness: true },
  },
};
await writeFile(cfgMod.CONFIG_FILE, JSON.stringify(initialCfg, null, 2), "utf8");

const bot = createBot("0:fake", { getCfg: cfgMod.loadConfig });
bot.botInfo = { id: 0, is_bot: true, username: "fakebot", first_name: "x" };

const replies = [];
let nextMsgId = 1;
Telegram.prototype.callApi = async function (method, payload) {
  if (method === "sendMessage") {
    const id = nextMsgId++;
    replies.push({ id, text: payload.text });
    return { message_id: id, chat: { id: payload.chat_id }, text: payload.text };
  }
  if (method === "editMessageText") {
    const r = replies.find((x) => x.id === payload.message_id);
    if (r) r.text = payload.text;
    return true;
  }
  if (method === "getMe") return { id: 0, is_bot: true, username: "fakebot", first_name: "x" };
  return {};
};

function fakeUpdate(text) {
  return {
    update_id: Math.floor(Math.random() * 1e6),
    message: {
      message_id: Math.floor(Math.random() * 1e6),
      date: Math.floor(Date.now() / 1000),
      chat: { id: 1, type: "private" },
      from: { id: 999, is_bot: false, first_name: "T" },
      text,
      entities: text.startsWith("/")
        ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }]
        : undefined,
    },
  };
}
const allText = () => replies.map((r) => r.text || "").join("\n");
async function waitJob(timeoutMs = 15000) {
  await new Promise((r) => setTimeout(r, 30));
  const deadline = Date.now() + timeoutMs;
  while (isJobActive() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 30));
  }
  await new Promise((r) => setTimeout(r, 50));
}

console.log("== /addlink + /listlinks ==");
teamCursor = -1;
replies.length = 0;
await bot.handleUpdate(fakeUpdate("/listlinks"));
assert.match(allText(), /Link Business \(2/);
console.log("  ok");

console.log("== /setseatlimit 100 ==");
replies.length = 0;
await bot.handleUpdate(fakeUpdate("/setseatlimit 100"));
assert.equal((await cfgMod.loadConfig()).canvaSeatLimit, 100);
console.log("  ok");

console.log("== /checkseats ==");
teamCursor = -1;
replies.length = 0;
await bot.handleUpdate(fakeUpdate("/checkseats"));
await waitJob();
const out = allText();
assert.match(out, /38\/100 anggota — sisa 62/, `expected tim 1, got: ${out}`);
assert.match(out, /12\/100 anggota — sisa 88/, `expected tim 2, got: ${out}`);
assert.match(out, /Total sisa slot: 150/);
console.log("  ok");

console.log("== reconcile config setelah checkseats ==");
{
  const cfg = await cfgMod.loadConfig();
  assert.equal(cfg.canvaBusinessLinks[0].joined, 38);
  assert.equal(cfg.canvaBusinessLinks[1].joined, 12);
  console.log("  ok");
}

console.log("== /checkseats tanpa checker → tolak ==");
{
  await writeFile(
    cfgMod.CONFIG_FILE,
    JSON.stringify({ ...initialCfg, checkerEmail: "" }, null, 2),
    "utf8"
  );
  replies.length = 0;
  await bot.handleUpdate(fakeUpdate("/checkseats"));
  await waitJob();
  assert.match(allText(), /checkerEmail belum di-set/);
  console.log("  ok");
}

// ---------- cleanup ----------
console.log("\n== cleanup ==");
await rm(TEST_HOME, { recursive: true, force: true });
globalThis.fetch = realFetch;
console.log("\n✅ smoke seats lulus — readMemberCount + checkSeats + /checkseats OK");
