// Verifikasi fix A: job fire-and-forget → /cancel jalan saat job aktif,
// dan ga ada MaxListenersExceededWarning saat banyak akun paralel.
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { rm, mkdir, writeFile } from "node:fs/promises";

const TEST_HOME = mkdtempSync(join(tmpdir(), "leobot-cancel-"));
process.env.LEOBOT_ACCOUNTS_DIR = join(TEST_HOME, "accounts");
process.env.LEOBOT_CONFIG_FILE = join(TEST_HOME, "config.json");

import { Telegram } from "telegraf";

// Tangkap warning MaxListeners
let sawMaxListenersWarning = false;
process.on("warning", (w) => {
  if (/MaxListenersExceeded/.test(w.name) || /MaxListenersExceeded/.test(w.message)) {
    sawMaxListenersWarning = true;
  }
});

// Mock chromium: signup LAMBAT (1.5 detik) + cek abort signal di tengah.
const playwright = await import("playwright-core");
let launched = 0;
let aborted = 0;
playwright.chromium.launch = async () => {
  launched++;
  return {
    newContext: async () => ({
      storageState: async () => ({ cookies: [] }),
      newPage: async () => makePage(),
    }),
    close: async () => {},
  };
};
function makePage() {
  const h = {};
  let url = "https://www.canva.com/";
  return {
    on: (e, f) => (h[e] = f),
    off: (e) => delete h[e],
    goto: async (u) => {
      url = u;
      await new Promise((r) => setTimeout(r, 400)); // lambat
      if (/leonardo\.ai/.test(u) && h.response) {
        Promise.resolve().then(() =>
          h.response({
            url: () => "https://api.leonardo.ai/v1/graphql",
            request: () => ({ method: () => "POST", postData: () => "{}" }),
            json: async () => ({
              data: { users: [{ user_details: [{ apiCredit: 500, subscriptionTokens: 100 }] }] },
            }),
          })
        );
      }
    },
    url: () => url,
    waitForURL: async (m) => {
      const s = m instanceof RegExp ? m.source : String(m);
      if (/oauth|authorize/.test(s)) url = "https://www.canva.com/oauth/authorize";
      else if (/leonardo/.test(s)) url = "https://app.leonardo.ai/";
    },
    waitForTimeout: async (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 200))),
    waitForLoadState: async () => {},
    locator: () => ({ first: () => loc(), waitFor: async () => {}, click: async () => {} }),
    keyboard: { type: async () => {} },
    mouse: { move: async () => {} },
    evaluate: async (fn, arg) => {
      const s = fn.toString();
      if (/domain_blocked/.test(s)) return null;
      if (/get-session/.test(s)) return { accessToken: "t", cognitoSub: "s" };
      if (/canva/.test(s) && /innerText/.test(s)) return true;
      if (typeof arg === "string") return true;
      return false;
    },
    waitForFunction: async () => ({ jsonValue: async () => "leo_x" }),
    close: async () => {},
  };
}
function loc() {
  return { waitFor: async () => {}, click: async () => {}, inputValue: async () => "", fill: async () => {}, first: () => loc() };
}

// Mock fetch Hubify, dengan OTP cek abort
const realFetch = globalThis.fetch;
let n = 0;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("inbox/create")) {
    n++;
    return jr({ success: true, data: { email: `c${n}@hubify.me`, domainId: 1 } });
  }
  if (u.includes("/otp")) {
    await new Promise((r) => setTimeout(r, 200));
    return jr({ success: true, data: { otp: "123456" } });
  }
  if (u.includes("hubify.store")) return jr({ success: true, data: {} });
  return realFetch(url, opts);
};
function jr(o) {
  return { ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) };
}

// Config terisolasi
const configModule = await import("../src/services/config.js");
await mkdir(configModule.ACCOUNTS_DIR, { recursive: true });
await writeFile(
  configModule.CONFIG_FILE,
  JSON.stringify({
    telegramToken: "0:fake",
    ownerIds: [999],
    apiKey: "secret",
    canvaBusinessUrl: "",
    domainId: null,
    headless: true,
    proxies: [],
    concurrency: 3,
    deleteInboxAfter: false,
    modes: { generate: { enableLeonardo: true }, login: { enableLeonardo: false, joinBusiness: true } },
  }),
  "utf8"
);

const { createBot } = await import("../src/bot.js");
const { isJobActive } = await import("../src/jobs.js");
const bot = createBot("0:fake", { getCfg: configModule.loadConfig });
bot.botInfo = { id: 0, is_bot: true, username: "fakebot", first_name: "x" };

const replies = [];
let id = 1;
Telegram.prototype.callApi = async function (method, payload) {
  if (method === "sendMessage") {
    const mid = id++;
    replies.push({ id: mid, text: payload.text });
    return { message_id: mid, chat: { id: payload.chat_id }, date: 0, text: payload.text };
  }
  if (method === "editMessageText") {
    const r = replies.find((x) => x.id === payload.message_id);
    if (r) r.text = payload.text;
    return true;
  }
  if (method === "answerCallbackQuery") return true;
  if (method === "getMe") return { id: 0, is_bot: true, username: "fakebot", first_name: "x" };
  return {};
};
const allText = () => replies.map((r) => r.text || "").join("\n");
function cmd(text) {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    message: {
      message_id: Math.floor(Math.random() * 1e9), date: 0,
      chat: { id: 1, type: "private" }, from: { id: 999, is_bot: false, first_name: "T" },
      text, entities: text.startsWith("/") ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] : undefined,
    },
  };
}

console.log("== fire-and-forget: handler return cepat saat job jalan ==");
const t0 = Date.now();
await bot.handleUpdate(cmd("/generate 8"));
const handlerMs = Date.now() - t0;
// Handler harus return cepat (<1 detik) walau job makan beberapa detik.
assert.ok(handlerMs < 1000, `handler harus return cepat, malah ${handlerMs}ms`);
// Job di-detach (microtask + await getCfg), kasih jeda kecil biar startJob jalan.
await new Promise((r) => setTimeout(r, 200));
assert.ok(isJobActive(), "job harus masih jalan setelah handler return");
console.log(`  ok (handler return ${handlerMs}ms, job jalan di background)`);

console.log("== /cancel jalan saat job aktif ==");
replies.length = 0;
const tc = Date.now();
await bot.handleUpdate(cmd("/cancel"));
const cancelMs = Date.now() - tc;
assert.ok(cancelMs < 1000, `/cancel harus responsif, malah ${cancelMs}ms`);
assert.match(allText(), /cancel dikirim|Sinyal cancel/i, `/cancel harus dibalas — got: ${allText()}`);
console.log(`  ok (/cancel dibalas ${cancelMs}ms)`);

// Tunggu job benar-benar berhenti
const deadline = Date.now() + 15000;
while (isJobActive() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
await new Promise((r) => setTimeout(r, 100));
assert.ok(!isJobActive(), "job harus berhenti setelah cancel");
console.log("  ok (job berhenti setelah cancel)");

console.log("== ga ada MaxListenersExceededWarning ==");
await new Promise((r) => setTimeout(r, 100));
assert.ok(!sawMaxListenersWarning, "ga boleh ada MaxListenersExceededWarning");
console.log("  ok");

await rm(TEST_HOME, { recursive: true, force: true });
globalThis.fetch = realFetch;
console.log("\n✅ smoke cancel lulus — fire-and-forget + /cancel + no listener leak");
