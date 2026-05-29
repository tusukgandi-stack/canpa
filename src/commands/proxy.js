// Proxy commands: /addproxy, /listproxy, /clearproxy, /loadproxy.
// /loadproxy: user reply pesan bot dengan attachment .txt → bot fetch isinya.
import { updateConfig } from "../services/config.js";
import {
  maskProxy,
  parseProxy,
  parseProxyList,
} from "../services/proxy.js";

export function registerProxy(bot, { getCfg }) {
  bot.command("addproxy", async (ctx) => {
    const raw = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!raw) return ctx.reply("Usage: /addproxy <proxy_url>");
    const parsed = parseProxy(raw);
    if (!parsed) {
      return ctx.reply(
        "Format proxy tidak dikenali. Contoh:\n" +
          "host:port\n" +
          "host:port:user:pass\n" +
          "user:pass@host:port\n" +
          "http://host:port\n" +
          "socks5://user:pass@host:port"
      );
    }
    await updateConfig((c) => {
      c.proxies = c.proxies || [];
      c.proxies.push(parsed);
    });
    const cfg = await getCfg();
    await ctx.reply(
      `Proxy ditambah: ${maskProxy(parsed)}\nTotal: ${cfg.proxies.length}`
    );
  });

  bot.command("listproxy", async (ctx) => {
    const cfg = await getCfg();
    if (!cfg.proxies?.length) return ctx.reply("Belum ada proxy.");
    const lines = cfg.proxies.map((p, i) => `${i + 1}. ${maskProxy(p)}`);
    await ctx.reply(`Proxy (${cfg.proxies.length}):\n\n${lines.join("\n")}`);
  });

  bot.command("clearproxy", async (ctx) => {
    await updateConfig((c) => {
      c.proxies = [];
    });
    await ctx.reply("Semua proxy dihapus.");
  });

  // /loadproxy: instruksi user kirim file .txt sebagai REPLY ke pesan bot ini.
  // Proses parsing-nya di handler `document` di bawah.
  bot.command("loadproxy", async (ctx) => {
    await ctx.reply(
      "Reply pesan ini dengan file .txt — 1 proxy per baris.\n" +
        "Format yang didukung sama dengan /addproxy."
    );
  });

  // Document handler — kalau user kirim .txt sebagai reply ke /loadproxy,
  // atau langsung kirim .txt dengan caption "/loadproxy", ambil isinya.
  bot.on("message", async (ctx, next) => {
    const doc = ctx.message?.document;
    if (!doc) return next();

    const replyTo = ctx.message.reply_to_message?.text || "";
    const caption = (ctx.message.caption || "").toLowerCase();
    const trigger =
      /loadproxy/i.test(replyTo) || caption.startsWith("/loadproxy");
    if (!trigger) return next();

    if (
      !doc.file_name?.toLowerCase().endsWith(".txt") &&
      !doc.mime_type?.includes("text")
    ) {
      return ctx.reply("File harus .txt");
    }

    try {
      const link = await ctx.telegram.getFileLink(doc.file_id);
      const res = await fetch(link.toString());
      if (!res.ok) throw new Error(`download HTTP ${res.status}`);
      const text = await res.text();
      const list = parseProxyList(text);
      if (!list.length) {
        return ctx.reply("Tidak ada proxy valid di file.");
      }
      await updateConfig((c) => {
        c.proxies = c.proxies || [];
        // dedup gabungan
        const merged = new Set([...c.proxies, ...list]);
        c.proxies = [...merged];
      });
      const cfg = await getCfg();
      await ctx.reply(
        `✅ Loaded ${list.length} proxy. Total sekarang: ${cfg.proxies.length}`
      );
    } catch (err) {
      await ctx.reply(`❌ Gagal load file: ${err.message}`);
    }
  });
}
