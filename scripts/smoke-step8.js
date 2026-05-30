// Full integration smoke test — mock chromium.launch + fetch (Hubify),
// boot bot, simulate updates, validate reply flow untuk semua command.
//
// PENTING: test ini set env LEOBOT_ACCOUNTS_DIR & LEOBOT_CONFIG_FILE ke folder
// temp terisolasi SEBELUM import apa pun, supaya TIDAK PERNAH nyentuh data akun
// / config produksi user.
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { rm } from "node:fs/promises";

// Isolasi: semua baca/tulis akun + config diarahkan ke folder temp.
const TEST_HOME = mkdtempSync(join(tmpdir(), "leobot-test-"));
process.env.LEOBOT_ACCOUNTS_DIR = join(TEST_HOME, "accounts");
process.env.LEOBOT_CONFIG_FILE = join(TEST_HOME, "config.json");

import { Telegram } from "telegraf";

// ---------- 1. Mock chromium.launch ----------
const playwright = await import("playwright-core");
let signupCounter = 0;
let loginCounter = 0;
let mode = "signup"; // tracks current scenario for fake page behavior
let leonardoUserPersist = '{"id":"\\"leo_user_x\\""}';

playwright.chromium.launch = async () => {
  const myAkun = ++signupCounter; // monotonic ID per launch
  return makeFakeBrowser(myAkun);
};

function makeFakeBrowser(akun) {
  return {
    newContext: async () => makeFakeContext(akun),
    close: async () => {},
  };
}

function makeFakeContext(akun) {
  const ctx = {
    _akun: akun,
    storageState: async () => ({ cookies: [], origins: [] }),
    newPage: async () => makeFakePage(akun, ctx),
  };
  return ctx;
}

function makeFakePage(akun, ctxRef) {
  const handlers = {};
  let url = "https://www.canva.com/";
  // For akun ke-3 di-trigger as failure path
  const fail = mode === "signup" && akun === 3;
  const emitCreditResponse = () => {
    if (!handlers.response) return;
    const fakeRes = {
      url: () => "https://api.leonardo.ai/v1/graphql",
      request: () => ({
        method: () => "POST",
        postData: () => '{"query":"..."}',
      }),
      json: async () => ({
        data: {
          users: [
            {
              user_details: [
                {
                  apiCredit: 500,
                  subscriptionTokens: 100,
                  subscriptionGptTokens: 0,
                  subscriptionModelTokens: 50,
                },
              ],
            },
          ],
        },
      }),
    };
    Promise.resolve().then(() => handlers.response(fakeRes));
  };
  return {
    on: (ev, fn) => {
      handlers[ev] = fn;
    },
    off: (ev) => {
      delete handlers[ev];
    },
    goto: async (u) => {
      url = u;
      if (/leonardo\.ai/.test(u)) emitCreditResponse();
    },
    url: () => url,
    // waitForURL: simulasi navigasi sukses. Kalau target consent canva, set url
    // ke consent; kalau leonardo, set ke leonardo. Selalu resolve (happy path).
    waitForURL: async (matcher) => {
      const src = matcher instanceof RegExp ? matcher.source : String(matcher);
      if (/oauth|authorize/.test(src)) {
        url = "https://www.canva.com/oauth/authorize?x=1";
      } else if (/leonardo/.test(src)) {
        url = "https://app.leonardo.ai/";
      }
    },
    waitForTimeout: async () => {},
    waitForLoadState: async () => {},
    locator: () => ({
      first: () => fakeLocator(),
      waitFor: async () => {},
      click: async () => {},
    }),
    keyboard: { type: async () => {} },
    mouse: { move: async () => {} },
    evaluate: async (fn, arg) => {
      const fnStr = fn.toString();
      // detectCanvaError → return kategori string atau null
      if (/domain_blocked/.test(fnStr)) {
        return fail ? "server_error" : null;
      }
      // extractLeonardoSession → fetch /api/auth/get-session
      if (/get-session/.test(fnStr)) {
        return { accessToken: "fake-access-token", cognitoSub: "sub-123" };
      }
      // "ready" check Canva home
      if (/canva/.test(fnStr) && /innerText/.test(fnStr)) return true;
      // clickByText evaluate body — arg = regex source string
      if (typeof arg === "string") return true;
      return false;
    },
    waitForFunction: async () => ({
      jsonValue: async () => "leo_user_x",
    }),
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
let hubifyEmailCounter = 0;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("hubify.store/api/ext/inbox/create")) {
    hubifyEmailCounter++;
    return jsonResponse({
      success: true,
      data: {
        email: `fakeacc${hubifyEmailCounter}@hubify.me`,
        domainId: 1,
        domain: "hubify.me",
      },
    });
  }
  if (u.includes("hubify.store/api/ext/inbox/") && u.endsWith("/otp")) {
    return jsonResponse({
      success: true,
      data: { otp: "123456", from: "noreply@canva.com" },
    });
  }
  if (u.includes("hubify.store/api/ext/inbox/") && opts?.method === "DELETE") {
    return jsonResponse({ success: true });
  }
  if (u.includes("hubify.store")) {
    return jsonResponse({ success: true, data: {} });
  }
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

// ---------- 3. Setup test accounts dir (terisolasi, dari env) ----------
const { mkdir } = await import("node:fs/promises");
const configModule = await import("../src/services/config.js");
const accountsDir = configModule.ACCOUNTS_DIR;
await mkdir(accountsDir, { recursive: true });

// ---------- 4. Boot bot (config.json terisolasi) ----------
const { createBot } = await import("../src/bot.js");
const { tail } = await import("../src/logger.js");
const { isJobActive } = await import("../src/jobs.js");

const FAKE_TOKEN = "0:fake";
const OWNER_ID = 999;

// Tulis config awal ke file terisolasi
const CONFIG_PATH = configModule.CONFIG_FILE;
const { writeFile } = await import("node:fs/promises");

const initialCfg = {
  telegramToken: FAKE_TOKEN,
  ownerIds: [OWNER_ID],
  apiKey: "secret",
  canvaBusinessUrl: "",
  domainId: null,
  headless: true,
  proxies: [],
  concurrency: 2,
  deleteInboxAfter: false,
  modes: {
    generate: { enableLeonardo: true },
    login: { enableLeonardo: false, joinBusiness: true },
  },
};
await writeFile(CONFIG_PATH, JSON.stringify(initialCfg, null, 2), "utf8");

// getCfg yang re-load dari disk tiap call (sama persis seperti production)
const bot = createBot(FAKE_TOKEN, { getCfg: configModule.loadConfig });
bot.botInfo = { id: 0, is_bot: true, username: "fakebot", first_name: "x" };

// Helper baca config dari disk
const cfgNow = async () => configModule.loadConfig();

// ---------- 5. Stub Telegram callApi ----------
const replies = [];
let nextMsgId = 1;
Telegram.prototype.callApi = async function (method, payload) {
  if (method === "sendMessage") {
    const id = nextMsgId++;
    replies.push({ id, chat: payload.chat_id, text: payload.text });
    return {
      message_id: id,
      chat: { id: payload.chat_id },
      date: 0,
      text: payload.text,
    };
  }
  if (method === "editMessageText") {
    const r = replies.find((x) => x.id === payload.message_id);
    if (r) r.text = payload.text;
    return true;
  }
  if (method === "deleteMessage") return true;
  if (method === "sendDocument") {
    replies.push({
      id: nextMsgId++,
      chat: payload.chat_id,
      doc: payload.caption || "(file)",
    });
    return {
      message_id: nextMsgId,
      chat: { id: payload.chat_id },
      date: 0,
    };
  }
  if (method === "getMe") {
    return { id: 0, is_bot: true, username: "fakebot", first_name: "x" };
  }
  return {};
};

function fakeUpdate(text, fromId = OWNER_ID) {
  return {
    update_id: Math.floor(Math.random() * 1e6),
    message: {
      message_id: Math.floor(Math.random() * 1e6),
      date: Math.floor(Date.now() / 1000),
      chat: { id: 1, type: "private" },
      from: { id: fromId, is_bot: false, first_name: "T" },
      text,
      entities: text.startsWith("/")
        ? [
            {
              type: "bot_command",
              offset: 0,
              length: text.split(" ")[0].length,
            },
          ]
        : undefined,
    },
  };
}

const lastReply = () => replies[replies.length - 1]?.text || "";
const allText = () => replies.map((r) => r.text || "").join("\n");

// Job sekarang fire-and-forget (detach). Tunggu sampai job selesai sebelum assert.
async function waitJob(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  // beri kesempatan job sempat mulai
  await new Promise((r) => setTimeout(r, 30));
  while (isJobActive() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 30));
  }
  // beri waktu finalize() + detail reply terkirim
  await new Promise((r) => setTimeout(r, 50));
}

// ---------- 6. Run scenarios ----------
console.log("== /start ==");
replies.length = 0;
await bot.handleUpdate(fakeUpdate("/start"));
assert.match(lastReply(), /Leo Bot Telegram/);
console.log("  ok");

console.log("== /help ==");
replies.length = 0;
await bot.handleUpdate(fakeUpdate("/help"));
assert.match(lastReply(), /\/togglemode/);
console.log("  ok");

console.log("== /settings ==");
replies.length = 0;
await bot.handleUpdate(fakeUpdate("/settings"));
assert.match(lastReply(), /apiKey/);
console.log("  ok");

console.log("== /setapikey ==");
replies.length = 0;
await bot.handleUpdate(fakeUpdate("/setapikey newkey123"));
assert.match(lastReply(), /apiKey set/);
assert.equal((await cfgNow()).apiKey, "newkey123");
console.log("  ok");

console.log("== /setconc 5 ==");
replies.length = 0;
await bot.handleUpdate(fakeUpdate("/setconc 5"));
assert.equal((await cfgNow()).concurrency, 5);
console.log("  ok");

console.log("== /headless on ==");
replies.length = 0;
await bot.handleUpdate(fakeUpdate("/headless on"));
assert.equal((await cfgNow()).headless, true);
console.log("  ok");

console.log("== /togglemode generate enableLeonardo off then on ==");
replies.length = 0;
await bot.handleUpdate(fakeUpdate("/togglemode generate enableLeonardo off"));
assert.equal((await cfgNow()).modes.generate.enableLeonardo, false);
await bot.handleUpdate(fakeUpdate("/togglemode generate enableLeonardo on"));
assert.equal((await cfgNow()).modes.generate.enableLeonardo, true);
console.log("  ok");

console.log("== /togglemode signup rejected (Canva-only) ==");
replies.length = 0;
await bot.handleUpdate(fakeUpdate("/togglemode signup enableLeonardo on"));
assert.match(lastReply(), /signup = Canva only|mode harus/);
console.log("  ok");

console.log("== /addproxy + /listproxy + /clearproxy ==");
await bot.handleUpdate(fakeUpdate("/addproxy user:pass@1.2.3.4:8080"));
await bot.handleUpdate(fakeUpdate("/listproxy"));
assert.match(lastReply(), /1\. http:\/\/user:\*\*\*@/);
await bot.handleUpdate(fakeUpdate("/clearproxy"));
assert.equal((await cfgNow()).proxies.length, 0);
console.log("  ok");

// Sebelum mode commands: pastikan concurrency = 2 dan headless on (sudah)
// supaya akun cepat dan deterministik.
// Reset apiKey kalau ke-clear
await writeFile(
  CONFIG_PATH,
  JSON.stringify(
    { ...initialCfg, headless: true, concurrency: 2, apiKey: "secret" },
    null,
    2
  ),
  "utf8"
);

console.log("== /generate 4 (akun #3 fail by mock) ==");
mode = "signup";
signupCounter = 0;
hubifyEmailCounter = 0;
replies.length = 0;
await bot.handleUpdate(fakeUpdate("/generate 4"));
await waitJob();
const finalGen = allText();
assert.match(
  finalGen,
  /Selesai: 3\/4 berhasil|Selesai: 4\/4|Selesai: \d\/4/,
  `gak ada summary — got: ${finalGen}`
);
assert.match(finalGen, /Detail akun \(generate\)/, "harus ada detail akun unmasked");
assert.match(finalGen, /fakeacc1@hubify\.me/, "email harus unmasked di detail");
console.log("  ok");

console.log("== /list ==");
replies.length = 0;
await bot.handleUpdate(fakeUpdate("/list"));
assert.match(lastReply(), /Daftar akun/);
console.log("  ok");

console.log("== /signup 2 ==");
mode = "signup";
signupCounter = 100; // start from 100 supaya akun #3 trigger ga ke-pakai
hubifyEmailCounter = 100;
replies.length = 0;
await bot.handleUpdate(fakeUpdate("/signup 2"));
await waitJob();
assert.match(allText(), /Selesai signup: 2\/2|Selesai signup: \d\/2/);
console.log("  ok");

console.log("== /login flow (slash /confirm) ==");
mode = "login";
loginCounter = 0;
replies.length = 0;
await bot.handleUpdate(fakeUpdate("/login"));
assert.match(lastReply(), /Kirim daftar email/);
replies.length = 0;
await bot.handleUpdate(fakeUpdate("acc1@hubify.me\nacc2@hubify.me"));
assert.match(lastReply(), /Akan login 2 akun/);
replies.length = 0;
await bot.handleUpdate(fakeUpdate("/confirm"));
await waitJob();
const finalLogin = allText();
assert.match(finalLogin, /Login: \d\/2/);
console.log("  ok");

console.log("== /credits ==");
mode = "credits";
replies.length = 0;
await bot.handleUpdate(fakeUpdate("/credits"));
await waitJob();
assert.match(lastReply(), /Total: \d aktif/);
console.log("  ok");

console.log("== /cancel idle ==");
replies.length = 0;
await bot.handleUpdate(fakeUpdate("/cancel"));
assert.match(lastReply(), /Tidak ada job aktif/);
console.log("  ok");

console.log("== /log ==");
replies.length = 0;
await bot.handleUpdate(fakeUpdate("/log"));
assert.ok(lastReply().length > 0);
console.log("  ok");

console.log("== /download ==");
replies.length = 0;
await bot.handleUpdate(fakeUpdate("/download"));
await new Promise((r) => setTimeout(r, 100));
const downloadAny = replies.some((r) => r.doc || /Bikin ZIP|Belum ada/.test(r.text || ""));
assert.ok(downloadAny, "harus ada reply terkait download");
console.log("  ok");

// ---------- 7. Cleanup ----------
console.log("\n== cleanup ==");
// Hapus seluruh folder temp terisolasi. Ga nyentuh data produksi sama sekali.
await rm(TEST_HOME, { recursive: true, force: true });

// Restore fetch
globalThis.fetch = realFetch;

console.log("\n✅ semua smoke step 8 lulus — full bot integration");
