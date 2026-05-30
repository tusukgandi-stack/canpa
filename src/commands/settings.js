// Settings commands — /settings, /setapikey, /setdomain, /setconc, /headless,
// /togglemode, plus multi-link Canva Business: /addlink /listlinks /removelink
// /clearlinks /setseatlimit /setchecker. Semua mutate config.json via updateConfig().
import { saveConfig, updateConfig } from "../services/config.js";
import { maskProxy } from "../services/proxy.js";

function maskKey(k) {
  if (!k) return "(kosong)";
  if (k.length <= 6) return "*".repeat(k.length);
  return k.slice(0, 3) + "***" + k.slice(-3);
}
function bool(v) {
  return v ? "ON" : "OFF";
}

export function registerSettings(bot, { getCfg }) {
  bot.command("settings", async (ctx) => {
    const cfg = await getCfg();
    const lines = [
      "Settings",
      "",
      `apiKey: ${maskKey(cfg.apiKey)}`,
      `canvaBusinessLinks: ${cfg.canvaBusinessLinks?.length ?? 0}`,
      `canvaSeatLimit: ${cfg.canvaSeatLimit ?? 100}`,
      `checkerEmail: ${cfg.checkerEmail || "(kosong)"}`,
      `domainId: ${cfg.domainId ?? "random"}`,
      `concurrency: ${cfg.concurrency}`,
      `headless: ${bool(cfg.headless)}`,
      `deleteInboxAfter: ${bool(cfg.deleteInboxAfter)}`,
      `proxies: ${cfg.proxies?.length ?? 0}${cfg.proxies?.length ? "" : " (tanpa proxy)"}`,
      "",
      "Mode toggles:",
      `- generate.enableLeonardo: ${bool(cfg.modes.generate.enableLeonardo)}`,
      `- login.enableLeonardo: ${bool(cfg.modes.login.enableLeonardo)}`,
      `- login.joinBusiness: ${bool(cfg.modes.login.joinBusiness)}`,
      "",
      "Link: /addlink /listlinks /removelink /clearlinks /setseatlimit /setchecker",
      "signup = Canva only (no toggle)",
    ];
    await ctx.reply(lines.join("\n"));
  });

  bot.command("setapikey", async (ctx) => {
    const arg = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!arg) return ctx.reply("Usage: /setapikey <hubify_api_key>");
    await updateConfig((c) => {
      c.apiKey = arg;
    });
    await ctx.reply(`✅ apiKey set: ${maskKey(arg)}`);
    // Hapus pesan asli supaya key ga ke-expose di history (best-effort)
    await ctx.deleteMessage().catch(() => {});
  });

  // ===== Multi-link Canva Business =====
  bot.command("addlink", async (ctx) => {
    const arg = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!arg) return ctx.reply("Usage: /addlink <canva_invite_url>");
    if (!/^https?:\/\//i.test(arg)) {
      return ctx.reply("URL harus diawali http:// atau https://");
    }
    let total = 0;
    let dup = false;
    await updateConfig((c) => {
      c.canvaBusinessLinks = c.canvaBusinessLinks || [];
      if (c.canvaBusinessLinks.some((l) => l.url === arg)) {
        dup = true;
      } else {
        c.canvaBusinessLinks.push({ url: arg, joined: 0 });
      }
      total = c.canvaBusinessLinks.length;
    });
    if (dup) return ctx.reply("Link itu udah ada.");
    await ctx.reply(`✅ Link ditambah (tim #${total}).\nTotal link: ${total}`);
  });

  bot.command("listlinks", async (ctx) => {
    const cfg = await getCfg();
    const links = cfg.canvaBusinessLinks || [];
    if (!links.length) return ctx.reply("Belum ada link Business. /addlink <url>");
    const limit = cfg.canvaSeatLimit || 100;
    const lines = links.map((l, i) => {
      const joined = l.joined || 0;
      const sisa = Math.max(0, limit - joined);
      return `${i + 1}. ${l.url}\n   ~${joined}/${limit} (sisa ~${sisa})`;
    });
    await ctx.reply(
      `Link Business (${links.length}, limit ${limit}/tim):\n\n${lines.join("\n")}\n\n` +
        "Angka ~ = estimasi. /checkseats buat hitung akurat."
    );
  });

  bot.command("removelink", async (ctx) => {
    const arg = ctx.message.text.split(" ")[1]?.trim();
    const idx = parseInt(arg, 10);
    if (Number.isNaN(idx) || idx < 1) {
      return ctx.reply("Usage: /removelink <nomor> (lihat /listlinks)");
    }
    let removed = null;
    let total = 0;
    await updateConfig((c) => {
      c.canvaBusinessLinks = c.canvaBusinessLinks || [];
      if (idx <= c.canvaBusinessLinks.length) {
        removed = c.canvaBusinessLinks.splice(idx - 1, 1)[0];
      }
      total = c.canvaBusinessLinks.length;
    });
    if (!removed) return ctx.reply("Nomor ga valid. Cek /listlinks.");
    await ctx.reply(`✅ Link #${idx} dihapus.\nSisa link: ${total}`);
  });

  bot.command("clearlinks", async (ctx) => {
    await updateConfig((c) => {
      c.canvaBusinessLinks = [];
    });
    await ctx.reply("Semua link Business dihapus.");
  });

  bot.command("setseatlimit", async (ctx) => {
    const arg = ctx.message.text.split(" ")[1]?.trim();
    const n = parseInt(arg, 10);
    if (Number.isNaN(n) || n < 1 || n > 1000) {
      return ctx.reply("Seat limit harus 1-1000. Usage: /setseatlimit <n>");
    }
    await updateConfig((c) => {
      c.canvaSeatLimit = n;
    });
    await ctx.reply(`✅ canvaSeatLimit: ${n}`);
  });

  bot.command("setchecker", async (ctx) => {
    const arg = ctx.message.text.split(" ")[1]?.trim();
    if (!arg) {
      await updateConfig((c) => {
        c.checkerEmail = "";
      });
      return ctx.reply("✅ checkerEmail dikosongkan");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(arg)) {
      return ctx.reply("Format email ga valid.");
    }
    await updateConfig((c) => {
      c.checkerEmail = arg;
    });
    await ctx.reply(
      `✅ checkerEmail: ${arg}\n` +
        "Pastikan akun ini udah join semua tim biar /checkseats bisa baca tiap tim."
    );
  });

  bot.command("setdomain", async (ctx) => {
    const arg = ctx.message.text.split(" ")[1]?.trim();
    if (!arg) return ctx.reply("Usage: /setdomain <id|random>");
    if (/^random$/i.test(arg)) {
      await updateConfig((c) => {
        c.domainId = null;
      });
      return ctx.reply("✅ domainId: random (server pilih)");
    }
    const id = parseInt(arg, 10);
    if (Number.isNaN(id) || id <= 0) {
      return ctx.reply("domainId harus angka positif atau 'random'");
    }
    await updateConfig((c) => {
      c.domainId = id;
    });
    await ctx.reply(`✅ domainId: ${id}`);
  });

  bot.command("setconc", async (ctx) => {
    const arg = ctx.message.text.split(" ")[1]?.trim();
    const n = parseInt(arg, 10);
    if (Number.isNaN(n) || n < 1 || n > 20) {
      return ctx.reply("Concurrency harus 1-20. Usage: /setconc <n>");
    }
    await updateConfig((c) => {
      c.concurrency = n;
    });
    await ctx.reply(`✅ concurrency: ${n}`);
  });

  bot.command("headless", async (ctx) => {
    const arg = ctx.message.text.split(" ")[1]?.toLowerCase().trim();
    if (!arg || !/^(on|off)$/.test(arg)) {
      return ctx.reply("Usage: /headless <on|off>");
    }
    const val = arg === "on";
    await updateConfig((c) => {
      c.headless = val;
    });
    await ctx.reply(`✅ headless: ${bool(val)}${val ? "\n⚠️ Canva detect headless dengan keras — banyak akun bakal gagal." : ""}`);
  });

  // /togglemode <mode> <key> <on|off>
  // mode: generate | login   (signup = Canva only, no toggle)
  // key: enableLeonardo | joinBusiness
  bot.command("togglemode", async (ctx) => {
    const parts = ctx.message.text.split(/\s+/).slice(1);
    const [mode, key, val] = parts;
    if (!mode || !key || !val) {
      return ctx.reply(
        "Usage: /togglemode <generate|login> <enableLeonardo|joinBusiness> <on|off>"
      );
    }
    if (!["generate", "login"].includes(mode)) {
      return ctx.reply(
        "mode harus: generate atau login (signup = Canva only, ga ada toggle)"
      );
    }
    if (!["enableLeonardo", "joinBusiness"].includes(key)) {
      return ctx.reply("key harus: enableLeonardo atau joinBusiness");
    }
    if (key === "joinBusiness" && mode !== "login") {
      return ctx.reply("joinBusiness cuma berlaku di mode login");
    }
    if (!/^(on|off)$/i.test(val)) {
      return ctx.reply("value harus: on atau off");
    }
    const flag = /^on$/i.test(val);
    await updateConfig((c) => {
      c.modes[mode][key] = flag;
    });
    await ctx.reply(`✅ ${mode}.${key} = ${bool(flag)}`);
  });
}

// Ekspor saveConfig juga biar dipakai dari proxy.js commands tanpa duplikasi
export { saveConfig };
