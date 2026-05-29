// /log — kirim 50 baris log terakhir. Kalau > 4096 char, kirim sebagai file.
import { Input } from "telegraf";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink, writeFile } from "node:fs/promises";
import { tail } from "../logger.js";

export async function runLog(ctx) {
  const lines = tail(50);
  if (!lines.length) return ctx.reply("Log kosong.");
  const text = lines.join("\n");
  if (text.length <= 3800) {
    return ctx.reply(text);
  }
  const tmp = join(tmpdir(), `leobot-log-${Date.now()}.txt`);
  await writeFile(tmp, text, "utf8");
  try {
    await ctx.replyWithDocument(Input.fromLocalFile(tmp), {
      caption: `${lines.length} log entries`,
    });
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

export function registerLog(bot) {
  bot.command("log", (ctx) => runLog(ctx));
}
