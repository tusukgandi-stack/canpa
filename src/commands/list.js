// /list — list email akun. Kalau >50, kirim sebagai file .txt biar ga limit message.
import { Input } from "telegraf";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, unlink } from "node:fs/promises";
import { scanAccounts } from "../services/accounts.js";

export async function runList(ctx) {
  const accounts = await scanAccounts();
  if (!accounts.length) return ctx.reply("Belum ada akun.");

  accounts.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const total = accounts.length;
  const totalCredit = accounts.reduce(
    (s, a) => s + (a.credits?.apiCredit ?? 0),
    0
  );

  if (total <= 50) {
    const lines = accounts.map((a, i) => {
      const c = a.credits?.apiCredit;
      return `${i + 1}. ${a.email}${c != null ? ` — ${c} credit` : ""}`;
    });
    const header = `Daftar akun (${total})${
      totalCredit ? ` · ${totalCredit.toLocaleString()} credit` : ""
    }\n\n`;
    return ctx.reply(header + lines.join("\n"));
  }

  const tmp = join(tmpdir(), `leobot-list-${Date.now()}.txt`);
  const body = [
    `# Daftar akun (${total})`,
    `# Total credit: ${totalCredit}`,
    `# Generated: ${new Date().toISOString()}`,
    "",
    ...accounts.map((a) => {
      const c = a.credits?.apiCredit;
      return `${a.email}${c != null ? ` # ${c} credit` : ""}`;
    }),
  ].join("\n");
  await writeFile(tmp, body, "utf8");
  try {
    await ctx.replyWithDocument(Input.fromLocalFile(tmp), {
      caption: `${total} akun · ${totalCredit.toLocaleString()} total credit`,
    });
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

export function registerList(bot) {
  bot.command("list", (ctx) => runList(ctx));
}
