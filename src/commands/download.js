// /download — kirim ZIP folder accounts/.
import { Input } from "telegraf";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
import { scanAccounts, zipAccounts } from "../services/accounts.js";

export async function runDownload(ctx) {
  const accounts = await scanAccounts();
  if (!accounts.length) return ctx.reply("Belum ada akun untuk di-zip.");
  const tmp = join(tmpdir(), `leobot-accounts-${Date.now()}.zip`);
  await ctx.reply(`Bikin ZIP ${accounts.length} akun...`);
  try {
    const size = await zipAccounts(tmp);
    await ctx.replyWithDocument(Input.fromLocalFile(tmp), {
      caption: `${accounts.length} akun · ${(size / 1024).toFixed(1)} KB`,
    });
  } catch (err) {
    await ctx.reply(`Gagal bikin ZIP: ${err.message}`);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

export function registerDownload(bot) {
  bot.command("download", (ctx) => runDownload(ctx));
}
