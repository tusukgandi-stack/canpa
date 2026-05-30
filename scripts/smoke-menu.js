// Smoke test menu/button flow — simulasi callback_query (tombol di-tap).
// Mock chromium + fetch sama kayak smoke-step8, fokus ke tombol.
//
// PENTING: set env isolasi SEBELUM import apa pun supaya TIDAK nyentuh data
// akun / config produksi.
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const TEST_HOME = mkdtempSync(join(tmpdir(), "leobot-menu-test-"));
process.env.LEOBOT_ACCOUNTS_DIR = join(TEST_HOME, "accounts");
process.env.LEOBOT_CONFIG_FILE = join(TEST_HOME, "config.json");

import { Telegram } from "telegraf";
import { mkdir, rm, writeFile } from "node:fs/promises";

// ---------- Mock chromium.launch (cepat, sukses) ----------
const playwright = await import("playwright-core");
let counter = 0;
playwright.chromium.launch = async () => {
  counter++;
  return {
    newContext: async () => ({
      storageState: async () => ({ cookies: [], origins: [] }),
      newPage: async () => makeFakePage(),
    }),
    close: async () => {},
  };
};
function makeFakePage() {
  const handlers = {};
  let url = "https://www.canva.com/";
  const emitCredit = () => {
    if (!handlers.response) return;
    Promise.resolve().then(() =>
      handlers.response({
        url: () => "https://api.leonardo.ai/v1/graphql",
        request: () => ({ method: () => "POST", postData: () => "{}" }),
        json: async () => ({
          data: { users: [{ user_details: [{ apiCredit: 500, subscriptionTokens: 100, subscriptionModelTokens: 0 }] }] },
        }),
      })
    );
  };
  return {
    on: (e, f) => (handlers[e] = f),
    off: (e) => delete handlers[e],
    goto: async (u) => {
      url = u;
      if (/leonardo\.ai/.test(u)) emitCredit();
    },
    url: () => url,
    waitForURL: async (m) => {
      const s = m instanceof RegExp ? m.source : String(m);
      if (/oauth|authorize/.test(s)) url = "https://www.canva.com/oauth/authorize";
      else if (/leonardo/.test(s)) url = "https://app.leonardo.ai/";
    },
    waitForTimeout: async () => {},
    waitForLoadState: async () => {},
    locator: () => ({ first: () => fakeLoc(), waitFor: async () => {}, click: async () => {} }),
    keyboard: { type: async () => {} },
    mouse: { move: async () => {} },
    evaluate: async (fn, arg) => {
      const s = fn.toString();
      if (/domain_blocked/.test(s)) return null;
      if (/get-session/.test(s)) return { accessToken: "tok", cognitoSub: "sub" };
      if (/canva/.test(s) && /innerText/.test(s)) return true;
      if (typeof arg === "string") return true;
      return false;
    },
    waitForFunction: async () => ({ jsonValue: async () => "leo_x" }),
    close: async () => {},
  };
}
function fakeLoc() {
  return { waitFor: async () => {}, click: async () => {}, inputValue: async () => "", fill: async () => {}, first: () => fakeLoc() };
}

// ---------- Mock fetch (Hubify) ----------
const realFetch = globalThis.fetch;
let emailN = 0;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("inbox/create")) {
    emailN++;
    return jr({ success: true, data: { email: `btnacc${emailN}@hubify.me`, domainId: 1, domain: "hubify.me" } });
  }
  if (u.includes("/otp")) return jr({ success: true, data: { otp: "123456" } });
  if (u.includes("hubify.store")) return jr({ success: true, data: {} });
  return realFetch(url, opts);
};
function jr(o) {
  return { ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) };
}

// ---------- Setup config + accounts (terisolasi via env) ----------
const configModule = await import("../src/services/config.js");
const accountsDir = configModule.ACCOUNTS_DIR;
await mkdir(accountsDir, { recursive: true });

const CONFIG_PATH = configModule.CONFIG_FILE;
const OWNER_ID = 999;
const FAKE_TOKEN = "0:fake";
await writeFile(
  CONFIG_PATH,
  JSON.stringify(
    {
      telegramToken: FAKE_TOKEN,
      ownerIds: [OWNER_ID],
      apiKey: "secret",
      canvaBusinessUrl: "",
      domainId: null,
      headless: true,
      proxies: [],
      concurrency: 2,
      deleteInboxAfter: false,
      modes: { generate: { enableLeonardo: true }, login: { enableLeonardo: false, joinBusiness: true } },
    },
    null,
    2
  ),
  "utf8"
);

const { createBot } = await import("../src/bot.js");
const { isJobActive } = await import("../src/jobs.js");
const bot = createBot(FAKE_TOKEN, { getCfg: configModule.loadConfig });
bot.botInfo = { id: 0, is_bot: true, username: "fakebot", first_name: "x" };
const cfgNow = () => configModule.loadConfig();

// Job fire-and-forget — tunggu selesai sebelum assert.
async function waitJob(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  await new Promise((r) => setTimeout(r, 30));
  while (isJobActive() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 30));
  }
  await new Promise((r) => setTimeout(r, 50));
}

// ---------- Stub Telegram ----------
const replies = [];
const edits = [];
let nextId = 1;
Telegram.prototype.callApi = async function (method, payload) {
  if (method === "sendMessage") {
    const id = nextId++;
    replies.push({ id, text: payload.text, markup: payload.reply_markup });
    return { message_id: id, chat: { id: payload.chat_id }, date: 0, text: payload.text };
  }
  if (method === "editMessageText") {
    edits.push({ id: payload.message_id, text: payload.text });
    const r = replies.find((x) => x.id === payload.message_id);
    if (r) r.text = payload.text;
    return true;
  }
  if (method === "answerCallbackQuery") return true;
  if (method === "sendDocument") {
    replies.push({ id: nextId++, doc: payload.caption });
    return { message_id: nextId, chat: { id: payload.chat_id }, date: 0 };
  }
  if (method === "deleteMessage") return true;
  if (method === "getMe") return { id: 0, is_bot: true, username: "fakebot", first_name: "x" };
  return {};
};

const lastReply = () => replies[replies.length - 1]?.text || "";
const lastEdit = () => edits[edits.length - 1]?.text || "";

function cmd(text, fromId = OWNER_ID) {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    message: {
      message_id: Math.floor(Math.random() * 1e9),
      date: 0,
      chat: { id: 1, type: "private" },
      from: { id: fromId, is_bot: false, first_name: "T" },
      text,
      entities: text.startsWith("/") ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] : undefined,
    },
  };
}
function tap(data, fromId = OWNER_ID) {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    callback_query: {
      id: String(Math.floor(Math.random() * 1e9)),
      from: { id: fromId, is_bot: false, first_name: "T" },
      message: { message_id: 1, chat: { id: 1, type: "private" }, date: 0, text: "menu" },
      chat_instance: "x",
      data,
    },
  };
}

// ========== Tests ==========
console.log("== /menu nampilin keyboard ==");
replies.length = 0;
await bot.handleUpdate(cmd("/menu"));
assert.match(lastReply(), /pilih menu/i);
assert.ok(replies[replies.length - 1].markup?.inline_keyboard?.length, "harus ada inline_keyboard");
console.log("  ok");

console.log("== tap Generate → count picker ==");
edits.length = 0;
await bot.handleUpdate(tap("m:generate"));
assert.match(lastEdit(), /berapa akun/i);
console.log("  ok");

console.log("== tap count 3 → job generate jalan ==");
counter = 0;
emailN = 0;
replies.length = 0;
edits.length = 0;
await bot.handleUpdate(tap("n:generate:3"));
await waitJob();
// reporter kirim pesan progress + finalize
const allText = [...replies.map((r) => r.text || ""), ...edits.map((e) => e.text)].join("\n");
assert.match(allText, /Selesai: \d\/3 berhasil/, `generate via tombol harus selesai — got:\n${allText}`);
console.log("  ok");

console.log("== tap Settings → toggle headless ==");
edits.length = 0;
await bot.handleUpdate(tap("m:settings"));
assert.match(lastEdit(), /Settings/);
const before = (await cfgNow()).headless;
await bot.handleUpdate(tap("s:toggle:headless"));
const after = (await cfgNow()).headless;
assert.notEqual(before, after, "toggle headless harus flip nilai");
console.log("  ok");

console.log("== tap Settings → set API key (pending input) ==");
replies.length = 0;
await bot.handleUpdate(tap("s:set:apikey"));
assert.match(lastReply(), /Kirim Hubify API key/);
replies.length = 0;
await bot.handleUpdate(cmd("my-new-key-123"));
assert.equal((await cfgNow()).apiKey, "my-new-key-123");
assert.match(lastReply(), /API key di-set/);
console.log("  ok");

console.log("== tap Proxy → Add (pending) → kirim proxy ==");
replies.length = 0;
await bot.handleUpdate(tap("p:add"));
assert.match(lastReply(), /Kirim proxy/);
replies.length = 0;
await bot.handleUpdate(cmd("user:pass@1.2.3.4:8080"));
assert.equal((await cfgNow()).proxies.length, 1);
assert.match(lastReply(), /Proxy ditambah/);
console.log("  ok");

console.log("== tap Generate → Custom → ketik angka ==");
replies.length = 0;
await bot.handleUpdate(tap("m:generate"));
await bot.handleUpdate(tap("n:generate:custom"));
assert.match(lastReply(), /Ketik jumlah akun/);
counter = 0;
emailN = 200;
replies.length = 0;
edits.length = 0;
await bot.handleUpdate(cmd("2"));
await waitJob();
const customText = [...replies.map((r) => r.text || ""), ...edits.map((e) => e.text)].join("\n");
assert.match(customText, /Selesai: \d\/2 berhasil/, `custom count harus jalan — got:\n${customText}`);
console.log("  ok");

console.log("== tap Login → kirim email → tombol Confirm ==");
replies.length = 0;
await bot.handleUpdate(tap("m:login"));
assert.match(lastReply(), /Kirim daftar email/);
replies.length = 0;
await bot.handleUpdate(cmd("loginacc1@hubify.me\nloginacc2@hubify.me"));
assert.match(lastReply(), /Akan login 2 akun/);
assert.ok(replies[replies.length - 1].markup?.inline_keyboard, "preview harus ada tombol Confirm");
counter = 0;
replies.length = 0;
edits.length = 0;
await bot.handleUpdate(tap("c:login:yes"));
await waitJob();
const loginText = [...replies.map((r) => r.text || ""), ...edits.map((e) => e.text)].join("\n");
assert.match(loginText, /Login: \d\/2/, `login via tombol harus selesai — got:\n${loginText}`);
console.log("  ok");

console.log("== tap Back → kembali ke menu utama ==");
edits.length = 0;
await bot.handleUpdate(tap("m:settings"));
await bot.handleUpdate(tap("m:home"));
assert.match(lastEdit(), /pilih menu/i);
console.log("  ok");

console.log("== stranger callback di-block ==");
replies.length = 0;
await bot.handleUpdate(tap("m:home", 1000));
assert.ok(
  replies.some((r) => /Unauthorized/i.test(r.text || "")),
  "stranger harus di-block"
);
console.log("  ok");

// ---------- Cleanup ----------
await rm(TEST_HOME, { recursive: true, force: true });
globalThis.fetch = realFetch;

console.log("\n✅ smoke menu lulus — semua tombol & callback flow OK");
