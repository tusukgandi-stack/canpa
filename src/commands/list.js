// /list — list email akun, dikelompokin per kategori (generate/signup/login).
// Kalau total >50, kirim sebagai file .txt.
import { Input } from "telegraf";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, unlink } from "node:fs/promises";
import { scanAccounts } from "../services/accounts.js";

const CAT_LABEL = {
  generate: "Generate (Canva + Leonardo)",
  signup: "Signup (Canva only)",
  login: "Login",
  uncategorized: "Lainnya",
};

function groupByCategory(accounts) {
  const groups = {};
  for (const a of accounts) {
    const cat = a.category || "uncategorized";
    (groups[cat] = groups[cat] || []).push(a);
  }
  for (const cat of Object.keys(groups)) {
    groups[cat].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }
  return groups;
}

export async function runList(ctx) {
  const accounts = await scanAccounts();
  if (!accounts.length) return ctx.reply("Belum ada akun.");

  const groups = groupByCategory(accounts);
  const order = ["generate", "signup", "login", "uncategorized"];
  const total = accounts.length;
  const totalCredit = accounts.reduce((s, a) => s + (a.credits?.apiCredit ?? 0), 0);

  if (total <= 50) {
    const blocks = [];
    for (const cat of order) {
      const list = groups[cat];
      if (!list?.length) continue;
      const lines = list.map((a, i) => {
        const c = a.credits?.apiCredit;
        return `${i + 1}. ${a.email}${c != null ? ` — ${c.toLocaleString()} credit` : ""}`;
      });
      blocks.push(`${CAT_LABEL[cat]} (${list.length}):\n${lines.join("\n")}`);
    }
    const header = `Daftar akun — total ${total}${
      totalCredit ? ` · ${totalCredit.toLocaleString()} credit` : ""
    }`;
    return ctx.reply(`${header}\n\n${blocks.join("\n\n")}`);
  }

  // >50 → file
  const tmp = join(tmpdir(), `leobot-list-${Date.now()}.txt`);
  const out = [`# Daftar akun — total ${total} · ${totalCredit} credit`, `# ${new Date().toISOString()}`, ""];
  for (const cat of order) {
    const list = groups[cat];
    if (!list?.length) continue;
    out.push(`## ${CAT_LABEL[cat]} (${list.length})`);
    for (const a of list) {
      const c = a.credits?.apiCredit;
      out.push(`${a.email}${c != null ? ` # ${c} credit` : ""}`);
    }
    out.push("");
  }
  await writeFile(tmp, out.join("\n"), "utf8");
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
