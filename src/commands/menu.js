// Menu interaktif berbasis inline keyboard + router callback query.
// Tujuan: kurangin ngetik slash command. Semua aksi bisa lewat tombol.
//
// Skema callback_data:
//   m:<action>            menu utama / navigasi (home, generate, signup, login,
//                         settings, proxy, credits, list, download, log, cancel)
//   n:<mode>:<count>      count picker → jalanin generate/signup (count angka / "custom")
//   c:<kind>:<yes|no>     konfirmasi (login)
//   s:set:<field>         settings yang butuh input teks
//   s:toggle:<key>        settings toggle ON/OFF
//   p:<action>            proxy (list/add/clear)
import { updateConfig } from "../services/config.js";
import { scanAccounts } from "../services/accounts.js";
import { maskProxy, parseProxy } from "../services/proxy.js";
import {
  backHome,
  countPicker,
  linksMenu,
  mainMenu,
  proxyMenu,
  settingsMenu,
} from "../keyboards.js";
import { clearPending, getPending, setPending } from "../pending-input.js";
import { detach } from "../jobs.js";
import { runGenerate } from "./generate.js";
import { runSignup } from "./signup.js";
import { runCredits } from "./credits.js";
import { runCheckSeats } from "./checkseats.js";
import { runList } from "./list.js";
import { runDownload } from "./download.js";
import { runCancel } from "./cancel.js";
import { runLog } from "./log.js";
import {
  clearPending as clearLoginPending,
  runLoginJob,
  startLoginPrompt,
  takePendingEmails,
} from "./login.js";

function maskKey(k) {
  if (!k) return "(kosong)";
  if (k.length <= 6) return "*".repeat(k.length);
  return k.slice(0, 3) + "***" + k.slice(-3);
}

const MENU_TITLE = "Leo Bot — pilih menu:";

async function showMainMenu(ctx, edit = false) {
  if (edit) {
    try {
      await ctx.editMessageText(MENU_TITLE, mainMenu());
      return;
    } catch {
      /* fallback kirim baru */
    }
  }
  await ctx.reply(MENU_TITLE, mainMenu());
}

async function showSettings(ctx, getCfg, edit = true) {
  const cfg = await getCfg();
  const text =
    "Settings\n\n" +
    `API key: ${maskKey(cfg.apiKey)}\n` +
    `Canva links: ${cfg.canvaBusinessLinks?.length ?? 0} (limit ${cfg.canvaSeatLimit ?? 100}/tim)\n` +
    `Checker: ${cfg.checkerEmail || "(kosong)"}\n` +
    `Domain: ${cfg.domainId ?? "random"}\n` +
    `Concurrency: ${cfg.concurrency}\n` +
    "\nTap tombol buat ubah:";
  if (edit) {
    try {
      await ctx.editMessageText(text, settingsMenu(cfg));
      return;
    } catch {
      /* fallback */
    }
  }
  await ctx.reply(text, settingsMenu(cfg));
}

async function showProxy(ctx, getCfg, edit = true) {
  const cfg = await getCfg();
  const count = cfg.proxies?.length ?? 0;
  const text = `Proxy — ${count} tersimpan`;
  if (edit) {
    try {
      await ctx.editMessageText(text, proxyMenu(count));
      return;
    } catch {
      /* fallback */
    }
  }
  await ctx.reply(text, proxyMenu(count));
}

async function showLinks(ctx, getCfg, edit = true) {
  const cfg = await getCfg();
  const links = cfg.canvaBusinessLinks || [];
  const limit = cfg.canvaSeatLimit || 100;
  let text;
  if (!links.length) {
    text = "Canva Links — belum ada. Tap Add buat nambah link tim.";
  } else {
    const lines = links.map((l, i) => {
      const joined = l.joined || 0;
      const sisa = Math.max(0, limit - joined);
      return `${i + 1}. ~${joined}/${limit} (sisa ~${sisa})\n   ${l.url}`;
    });
    text =
      `Canva Links (${links.length}, limit ${limit}/tim)\n` +
      `Checker: ${cfg.checkerEmail || "(kosong)"}\n\n` +
      lines.join("\n") +
      "\n\nAngka ~ = estimasi. Cek Seat buat hitung akurat.";
  }
  if (edit) {
    try {
      await ctx.editMessageText(text, linksMenu(links.length));
      return;
    } catch {
      /* fallback */
    }
  }
  await ctx.reply(text, linksMenu(links.length));
}

// Prompt input teks untuk field tertentu
const SET_PROMPTS = {
  apikey: "Kirim Hubify API key:",
  domain: "Kirim domain ID (angka) atau ketik random:",
  conc: "Kirim concurrency (1-20):",
};

export function registerMenu(bot, { getCfg }) {
  // /menu dan /start nampilin menu
  bot.command("menu", (ctx) => showMainMenu(ctx, false));

  // === Router callback query ===
  bot.on("callback_query", async (ctx) => {
    const data = ctx.callbackQuery?.data || "";
    // Selalu answer biar loading spinner di tombol ilang
    const ack = (text) => ctx.answerCbQuery(text).catch(() => {});

    try {
      const [ns, a, b] = data.split(":");

      // ---- Menu utama / navigasi ----
      if (ns === "m") {
        switch (a) {
          case "home":
            await ack();
            return showMainMenu(ctx, true);
          case "generate":
            await ack();
            return ctx.editMessageText("Generate — berapa akun?", countPicker("generate"));
          case "signup":
            await ack();
            return ctx.editMessageText("Signup — berapa akun?", countPicker("signup"));
          case "login":
            await ack();
            return startLoginPrompt(ctx, { getCfg });
          case "settings":
            await ack();
            return showSettings(ctx, getCfg, true);
          case "proxy":
            await ack();
            return showProxy(ctx, getCfg, true);
          case "credits":
            await ack("Mulai cek credit...");
            return detach(() => runCredits(ctx, { getCfg }));
          case "checkseats":
            await ack("Cek seat...");
            return detach(() => runCheckSeats(ctx, { getCfg }));
          case "links":
            await ack();
            return showLinks(ctx, getCfg, true);
          case "list":
            await ack();
            return runList(ctx);
          case "download":
            await ack("Bikin ZIP...");
            return detach(() => runDownload(ctx));
          case "log":
            await ack();
            return runLog(ctx);
          case "cancel":
            await ack();
            return runCancel(ctx);
          default:
            return ack();
        }
      }

      // ---- Count picker → jalanin job ----
      if (ns === "n") {
        const mode = a; // generate | signup
        if (b === "custom") {
          await ack();
          setPending(ctx.chat.id, "count", { mode });
          return ctx.reply(`Ketik jumlah akun buat ${mode} (1-50):`);
        }
        const n = Math.min(Math.max(parseInt(b) || 1, 1), 50);
        await ack(`Mulai ${mode} ${n}...`);
        // Hapus keyboard biar ga di-tap 2x
        await ctx.editMessageText(`${mode} ${n} akun — mulai...`).catch(() => {});
        if (mode === "generate") return detach(() => runGenerate(ctx, n, { getCfg }));
        return detach(() => runSignup(ctx, n, { getCfg }));
      }

      // ---- Konfirmasi (login) ----
      if (ns === "c") {
        const kind = a;
        const yes = b === "yes";
        if (kind === "login") {
          if (!yes) {
            clearLoginPending(ctx.chat.id);
            await ack("Dibatalin");
            return ctx.editMessageText("Login dibatalin.").catch(() => {});
          }
          const emails = takePendingEmails(ctx.chat.id);
          if (!emails) {
            await ack("Sesi kadaluarsa");
            return ctx.editMessageText("Sesi login kadaluarsa. Mulai lagi.").catch(() => {});
          }
          await ack(`Mulai login ${emails.length}...`);
          await ctx.editMessageText(`Login ${emails.length} akun — mulai...`).catch(() => {});
          return detach(() => runLoginJob(ctx, emails, { getCfg }));
        }
        return ack();
      }

      // ---- Settings: input teks ----
      if (ns === "s" && a === "set") {
        await ack();
        setPending(ctx.chat.id, `set_${b}`);
        return ctx.reply(SET_PROMPTS[b] || "Kirim value:");
      }

      // ---- Settings: toggle ----
      if (ns === "s" && a === "toggle") {
        let label = "";
        await updateConfig((c) => {
          switch (b) {
            case "headless":
              c.headless = !c.headless;
              label = `Headless: ${c.headless ? "ON" : "OFF"}`;
              break;
            case "gen_leo":
              c.modes.generate.enableLeonardo = !c.modes.generate.enableLeonardo;
              label = `Leonardo generate: ${c.modes.generate.enableLeonardo ? "ON" : "OFF"}`;
              break;
            case "login_leo":
              c.modes.login.enableLeonardo = !c.modes.login.enableLeonardo;
              label = `Leonardo login: ${c.modes.login.enableLeonardo ? "ON" : "OFF"}`;
              break;
            case "login_biz":
              c.modes.login.joinBusiness = !c.modes.login.joinBusiness;
              label = `Join Business: ${c.modes.login.joinBusiness ? "ON" : "OFF"}`;
              break;
          }
        });
        await ack(label);
        return showSettings(ctx, getCfg, true); // refresh keyboard
      }

      // ---- Proxy ----
      if (ns === "p") {
        const cfg = await getCfg();
        if (a === "list") {
          await ack();
          if (!cfg.proxies?.length) return ctx.reply("Belum ada proxy.");
          const lines = cfg.proxies.map((p, i) => `${i + 1}. ${maskProxy(p)}`);
          return ctx.reply(`Proxy (${cfg.proxies.length}):\n${lines.join("\n")}`);
        }
        if (a === "add") {
          await ack();
          setPending(ctx.chat.id, "proxy_add");
          return ctx.reply(
            "Kirim proxy (host:port / user:pass@host:port / http://... / socks5://...):"
          );
        }
        if (a === "clear") {
          await updateConfig((c) => {
            c.proxies = [];
          });
          await ack("Proxy dihapus");
          return showProxy(ctx, getCfg, true);
        }
      }

      // ---- Canva Links (multi-link Business) ----
      if (ns === "l") {
        if (a === "list") {
          await ack();
          return showLinks(ctx, getCfg, true);
        }
        if (a === "add") {
          await ack();
          setPending(ctx.chat.id, "link_add");
          return ctx.reply("Kirim Canva invite URL (http/https):");
        }
        if (a === "clear") {
          await updateConfig((c) => {
            c.canvaBusinessLinks = [];
          });
          await ack("Link dihapus");
          return showLinks(ctx, getCfg, true);
        }
        if (a === "checker") {
          await ack();
          setPending(ctx.chat.id, "set_checker");
          return ctx.reply(
            "Kirim email checker (Hubify-managed, atau ketik - buat kosongin):"
          );
        }
        if (a === "limit") {
          await ack();
          setPending(ctx.chat.id, "set_seatlimit");
          return ctx.reply("Kirim seat limit per tim (1-1000):");
        }
      }

      return ack();
    } catch (err) {
      await ack("Error");
    }
  });

  // === Handler input teks pending (settings value / custom count / proxy add) ===
  // Didaftar sebagai middleware message; next() kalau ga ada pending.
  bot.on("message", async (ctx, next) => {
    const p = getPending(ctx.chat?.id);
    if (!p) return next();
    const text = ctx.message?.text?.trim();
    if (!text || text.startsWith("/")) return next();

    clearPending(ctx.chat.id);

    switch (p.kind) {
      case "count": {
        const n = Math.min(Math.max(parseInt(text) || 0, 1), 50);
        if (!n) return ctx.reply("Angka ga valid. Coba lagi dari menu.");
        if (p.meta.mode === "generate") return detach(() => runGenerate(ctx, n, { getCfg }));
        return detach(() => runSignup(ctx, n, { getCfg }));
      }
      case "set_apikey":
        await updateConfig((c) => {
          c.apiKey = text;
        });
        await ctx.reply(`API key di-set: ${maskKey(text)}`, backHome());
        await ctx.deleteMessage().catch(() => {});
        return;
      case "link_add": {
        if (!/^https?:\/\//i.test(text)) {
          return ctx.reply("URL harus diawali http:// atau https://. Coba lagi dari menu.");
        }
        let total = 0;
        let dup = false;
        await updateConfig((c) => {
          c.canvaBusinessLinks = c.canvaBusinessLinks || [];
          if (c.canvaBusinessLinks.some((l) => l.url === text)) dup = true;
          else c.canvaBusinessLinks.push({ url: text, joined: 0 });
          total = c.canvaBusinessLinks.length;
        });
        if (dup) return ctx.reply("Link itu udah ada.", backHome());
        return ctx.reply(`Link ditambah (tim #${total}). Total: ${total}`, backHome());
      }
      case "set_checker": {
        if (text === "-") {
          await updateConfig((c) => {
            c.checkerEmail = "";
          });
          return ctx.reply("Checker email dikosongkan.", backHome());
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
          return ctx.reply("Format email ga valid. Coba lagi dari menu.");
        }
        await updateConfig((c) => {
          c.checkerEmail = text;
        });
        return ctx.reply(`Checker email di-set: ${text}`, backHome());
      }
      case "set_seatlimit": {
        const n = parseInt(text, 10);
        if (Number.isNaN(n) || n < 1 || n > 1000) {
          return ctx.reply("Seat limit harus 1-1000. Coba lagi dari menu.");
        }
        await updateConfig((c) => {
          c.canvaSeatLimit = n;
        });
        return ctx.reply(`Seat limit: ${n}.`, backHome());
      }
      case "set_domain": {
        if (/^random$/i.test(text)) {
          await updateConfig((c) => {
            c.domainId = null;
          });
          return ctx.reply("Domain: random.", backHome());
        }
        const id = parseInt(text, 10);
        if (Number.isNaN(id) || id <= 0) {
          return ctx.reply("Domain ID harus angka positif atau 'random'.");
        }
        await updateConfig((c) => {
          c.domainId = id;
        });
        return ctx.reply(`Domain ID: ${id}.`, backHome());
      }
      case "set_conc": {
        const n = parseInt(text, 10);
        if (Number.isNaN(n) || n < 1 || n > 20) {
          return ctx.reply("Concurrency harus 1-20. Coba lagi dari menu.");
        }
        await updateConfig((c) => {
          c.concurrency = n;
        });
        return ctx.reply(`Concurrency: ${n}.`, backHome());
      }
      case "proxy_add": {
        const parsed = parseProxy(text);
        if (!parsed) {
          return ctx.reply("Format proxy ga dikenali. Coba lagi dari menu Proxy.");
        }
        await updateConfig((c) => {
          c.proxies = c.proxies || [];
          c.proxies.push(parsed);
        });
        const cfg = await getCfg();
        return ctx.reply(
          `Proxy ditambah: ${maskProxy(parsed)}\nTotal: ${cfg.proxies.length}`,
          backHome()
        );
      }
      default:
        return next();
    }
  });
}
