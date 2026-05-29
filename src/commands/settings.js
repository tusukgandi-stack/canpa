// Settings commands — /settings, /setapikey, /setcanva, /setdomain, /setconc,
// /headless, /togglemode. Semua mutate config.json via updateConfig().
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
      `canvaBusinessUrl: ${cfg.canvaBusinessUrl || "(kosong)"}`,
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

  bot.command("setcanva", async (ctx) => {
    const arg = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!arg) {
      await updateConfig((c) => {
        c.canvaBusinessUrl = "";
      });
      return ctx.reply("✅ canvaBusinessUrl dikosongkan");
    }
    if (!/^https?:\/\//i.test(arg)) {
      return ctx.reply("URL harus diawali http:// atau https://");
    }
    await updateConfig((c) => {
      c.canvaBusinessUrl = arg;
    });
    await ctx.reply(`✅ canvaBusinessUrl set:\n${arg}`);
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
