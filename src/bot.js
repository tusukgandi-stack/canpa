// Factory bot Telegraf: register middleware + commands + menu interaktif.
// `getCfg` adalah loader async yang return config terbaru (re-read tiap call
// supaya update config via /setapikey / tombol langsung berlaku tanpa restart).
import { Telegraf } from "telegraf";
import { ownerOnly } from "./auth.js";
import { error as logError, log } from "./logger.js";
import { registerStart } from "./commands/start.js";
import { registerSettings } from "./commands/settings.js";
import { registerGenerate } from "./commands/generate.js";
import { registerSignup } from "./commands/signup.js";
import { registerLogin } from "./commands/login.js";
import { registerCredits } from "./commands/credits.js";
import { registerList } from "./commands/list.js";
import { registerDownload } from "./commands/download.js";
import { registerCancel } from "./commands/cancel.js";
import { registerLog } from "./commands/log.js";
import { registerProxy } from "./commands/proxy.js";
import { registerMenu } from "./commands/menu.js";

// Daftar command yang muncul di tombol "Menu" native Telegram (setMyCommands).
const COMMAND_LIST = [
  { command: "menu", description: "Buka menu tombol" },
  { command: "generate", description: "Generate akun (Canva + Leonardo)" },
  { command: "signup", description: "Signup Canva aja" },
  { command: "login", description: "Login akun yang udah ada" },
  { command: "credits", description: "Cek credit Leonardo" },
  { command: "list", description: "Daftar akun" },
  { command: "download", description: "Download ZIP akun" },
  { command: "settings", description: "Lihat/ubah setting" },
  { command: "cancel", description: "Batalin job aktif" },
  { command: "log", description: "Log terakhir" },
  { command: "help", description: "Bantuan" },
];

export function createBot(token, { getCfg }) {
  if (!token) throw new Error("telegramToken kosong di config.json");
  const bot = new Telegraf(token);

  // Middleware: log inbound + whitelist owner
  bot.use(async (ctx, next) => {
    const text =
      ctx.message?.text ||
      (ctx.update?.callback_query?.data
        ? `[btn] ${ctx.update.callback_query.data}`
        : "");
    log(
      "bot",
      `from=${ctx.from?.id}(@${ctx.from?.username || "n/a"}) ${text.slice(0, 80)}`
    );
    await next();
  });
  bot.use(ownerOnly(getCfg));

  // === Commands ===
  registerStart(bot, { getCfg });
  registerSettings(bot, { getCfg });
  registerGenerate(bot, { getCfg });
  registerSignup(bot, { getCfg });
  registerLogin(bot, { getCfg });
  registerCredits(bot, { getCfg });
  registerList(bot);
  registerDownload(bot);
  registerCancel(bot);
  registerLog(bot);
  registerProxy(bot, { getCfg });
  // Menu (callback router + pending-input handler) — daftar terakhir biar
  // command handler & message handler lain dapet giliran lewat next() dulu.
  registerMenu(bot, { getCfg });

  // Set native command menu (best-effort, ga blocking startup)
  bot.telegram.setMyCommands(COMMAND_LIST).catch((e) => {
    logError("bot", "setMyCommands gagal:", e?.message || e);
  });

  // Catch-all error handler
  bot.catch((err, ctx) => {
    logError("bot", `update ${ctx.update?.update_id} error:`, err);
    ctx.reply(`Error: ${err.message || err}`).catch(() => {});
  });

  return bot;
}
