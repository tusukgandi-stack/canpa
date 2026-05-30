// /start dan /help — ringkasan status + buka menu tombol.
import { scanAccounts } from "../services/accounts.js";
import { mainMenu } from "../keyboards.js";

function bool(v) {
  return v ? "ON" : "OFF";
}

async function buildStatus(getCfg) {
  const cfg = await getCfg();
  const acc = await scanAccounts();
  return [
    "Leo Bot Telegram",
    "",
    `Owner: ${cfg.ownerIds.length} ID`,
    `Hubify API key: ${cfg.apiKey ? "set" : "kosong"}`,
    `Canva links: ${cfg.canvaBusinessLinks?.length ?? 0} (limit ${cfg.canvaSeatLimit ?? 100}/tim)`,
    `Checker: ${cfg.checkerEmail ? "set" : "kosong"}`,
    `Proxy: ${cfg.proxies?.length ?? 0}`,
    `Headless: ${bool(cfg.headless)}`,
    `Concurrency: ${cfg.concurrency}`,
    `Akun di disk: ${acc.length}`,
    "",
    `Leonardo (generate): ${bool(cfg.modes.generate.enableLeonardo)}`,
    `Leonardo (login): ${bool(cfg.modes.login.enableLeonardo)} · Join Business: ${bool(
      cfg.modes.login.joinBusiness
    )}`,
    "signup: Canva only",
    "",
    "Pilih menu di bawah, atau /help buat daftar command.",
  ].join("\n");
}

const HELP_TEXT = [
  "Daftar command",
  "",
  "Mode:",
  "/generate <n> — full: Canva + Leonardo + cek credit",
  "/signup <n> — signup Canva aja",
  "/login — login akun yang udah ada",
  "",
  "Settings:",
  "/settings — lihat/ubah setting",
  "/setapikey <key> — set Hubify API key",
  "/setdomain <id|random> — set domain Hubify",
  "/setconc <n> — set concurrency (1-20)",
  "/headless <on|off> — toggle headless",
  "/togglemode <mode> <key> <on|off> — toggle per-mode",
  "",
  "Canva Business links:",
  "/addlink <url> · /listlinks · /removelink <n> · /clearlinks",
  "/setseatlimit <n> — limit member per tim (default 100)",
  "/setchecker <email> — akun buat cek seat",
  "/checkseats — cek sisa seat tiap link",
  "",
  "Proxy:",
  "/addproxy <url> · /listproxy · /clearproxy · /loadproxy",
  "",
  "Akun:",
  "/credits · /list · /download",
  "",
  "Job:",
  "/cancel · /log",
  "",
  "Atau tinggal pakai /menu buat tombol.",
].join("\n");

export function registerStart(bot, { getCfg }) {
  bot.command("start", async (ctx) => {
    const text = await buildStatus(getCfg);
    await ctx.reply(text, mainMenu());
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(HELP_TEXT);
  });
}
