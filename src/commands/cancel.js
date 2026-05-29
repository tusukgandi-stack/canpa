// /cancel — abort job aktif.
import { abortJob, describeCurrent, isJobActive } from "../jobs.js";

export async function runCancel(ctx) {
  if (!isJobActive()) {
    return ctx.reply("Tidak ada job aktif yang bisa dibatalin.");
  }
  const tag = describeCurrent();
  abortJob("user cancel");
  await ctx.reply(
    `Sinyal cancel dikirim untuk: ${tag}\nBrowser yang lagi jalan bakal di-close. Akun yang udah complete tetep ke-save.`
  );
}

export function registerCancel(bot) {
  bot.command("cancel", (ctx) => runCancel(ctx));
}
