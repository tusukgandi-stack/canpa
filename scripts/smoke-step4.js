// Smoke test step 4 — bot init + auth middleware + /start /help registration.
// Tanpa konek ke Telegram beneran. Telegraf bisa di-handleUpdate manual untuk simulasi.
import { strict as assert } from "node:assert";
import { createBot } from "../src/bot.js";
import { _resetRing, tail } from "../src/logger.js";

const FAKE_TOKEN = "0:fake-token-for-test";
const OWNER_ID = 999;
const STRANGER_ID = 1000;

const baseCfg = {
  telegramToken: FAKE_TOKEN,
  ownerIds: [OWNER_ID],
  apiKey: "secretkey",
  canvaBusinessUrl: "https://www.canva.com/brand/join?token=abc",
  domainId: null,
  headless: false,
  proxies: ["http://u:p@gw.dataimpulse.com:823"],
  concurrency: 3,
  deleteInboxAfter: false,
  modes: {
    generate: { enableLeonardo: true },
    login: { enableLeonardo: false, joinBusiness: true },
  },
};

import { Telegram } from "telegraf";

const getCfg = async () => baseCfg;
const bot = createBot(FAKE_TOKEN, { getCfg });

// Telegraf creates a NEW Telegram instance per update inside handleUpdate, so
// patch at the prototype level. Capture sendMessage; other methods return
// minimal stub responses.
const replies = [];
Telegram.prototype.callApi = async function (method, payload) {
  if (method === "sendMessage") {
    replies.push({ chat: payload.chat_id, text: payload.text });
    return {
      message_id: replies.length,
      chat: { id: payload.chat_id },
      date: 0,
      text: payload.text,
    };
  }
  if (method === "getMe") {
    return { id: 0, is_bot: true, username: "fakebot", first_name: "x" };
  }
  if (method === "editMessageText") {
    return true;
  }
  return {};
};
bot.botInfo = { id: 0, is_bot: true, username: "fakebot", first_name: "x" };

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
        ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }]
        : undefined,
    },
  };
}

// Monkey-patch above already covers replies.

console.log("== /start (owner) ==");
_resetRing();
await bot.handleUpdate(fakeUpdate("/start"));
assert.equal(replies.length, 1, "harus dapet 1 reply dari /start");
assert.match(replies[0].text, /Leo Bot Telegram/);
assert.match(replies[0].text, /Hubify API key: set/);
assert.match(replies[0].text, /Headless: OFF/);
assert.match(replies[0].text, /Concurrency: 3/);
assert.match(replies[0].text, /Leonardo \(generate\): ON/);
assert.match(replies[0].text, /signup: Canva only/);
console.log("  ok");

console.log("== /help (owner) ==");
replies.length = 0;
await bot.handleUpdate(fakeUpdate("/help"));
assert.equal(replies.length, 1);
assert.match(replies[0].text, /\/generate <n>/);
assert.match(replies[0].text, /\/signup <n>/);
assert.match(replies[0].text, /\/login/);
assert.match(replies[0].text, /\/togglemode/);
console.log("  ok");

console.log("== /start (stranger -> Unauthorized) ==");
replies.length = 0;
_resetRing();
await bot.handleUpdate(fakeUpdate("/start", STRANGER_ID));
assert.equal(replies.length, 1);
assert.match(replies[0].text, /Unauthorized/);
const logs = tail(50).join("\n");
assert.match(logs, /Unauthorized: from=1000/);
console.log("  ok");

console.log("== logger ring buffer ==");
const lines = tail(50);
assert.ok(lines.length > 0, "logger harus ke-isi ring buffer");
console.log(`  ok (${lines.length} entries)`);

console.log("\n✅ smoke step 4 lulus — bot skeleton + auth + /start /help OK");
