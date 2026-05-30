// /credits — cek credit Leonardo semua akun di accounts/.
// Sequential supaya ga mengganggu mode lain. Reuse ProgressReporter.
import { scanAccounts } from "../services/accounts.js";
import { checkOneCredits, sumCredits } from "../services/leonardo-credits.js";
import { maskEmail } from "../services/playwright-helpers.js";
import { endJob, isJobActive, startJob } from "../jobs.js";
import { scoped } from "../logger.js";
import { ProgressReporter } from "../progress.js";

export async function runCredits(ctx, { getCfg }) {
  if (isJobActive()) {
    return ctx.reply("Job lain lagi jalan. Batalin dulu (Cancel / /cancel).");
  }
  const all = await scanAccounts();
  if (!all.length) {
    return ctx.reply("Belum ada akun. Generate dulu.");
  }
  // Cuma akun yang punya Leonardo yang relevan buat cek credit.
  // Signup (Canva only) di-skip karena emang ga ada Leonardo.
  const accounts = all.filter((a) => a.leonardoUserId || a.category === "generate");
  if (!accounts.length) {
    return ctx.reply(
      "Ga ada akun ber-Leonardo buat dicek. Signup (Canva only) ga punya credit Leonardo."
    );
  }

  const cfg = await getCfg();
  const job = startJob({ mode: "credits", total: accounts.length, ctx });
  const reporter = new ProgressReporter(ctx, accounts.length, "generate");
  reporter.headerExtra = "Cek Leonardo credits";
  await reporter.start();
  const log = scoped(`credits-${job.id.slice(-6)}`);

  const results = [];
  try {
    for (let i = 0; i < accounts.length; i++) {
      if (job.signal.aborted) {
        reporter.update(i, `[${i + 1}] dibatalkan`);
        continue;
      }
      const acc = accounts[i];
      reporter.update(i, `[${i + 1}] cek ${maskEmail(acc.email)}`);
      const r = await checkOneCredits(acc.email, {
        headless: cfg.headless,
        signal: job.signal,
      });
      results.push(r);
      if (r.ok) {
        reporter.update(
          i,
          `[${i + 1}] ✓ ${maskEmail(acc.email)} — ${r.credits.apiCredit ?? 0} credit · ${r.credits.subscriptionTokens ?? 0} tokens`
        );
      } else {
        reporter.update(i, `[${i + 1}] ✗ ${maskEmail(acc.email)} — ${r.error}`);
        log.warn(`${acc.email} fail: ${r.error}`);
      }
      job.completed = i + 1;
    }

    const sum = sumCredits(results);
    const summary =
      `\nTotal: ${sum.okCount} aktif / ${sum.failCount} bermasalah` +
      `\nCredit: ${sum.totalApi.toLocaleString()}` +
      `\nTokens: ${sum.totalSubscriptionTokens.toLocaleString()}` +
      `\nModel tokens: ${sum.totalModelTokens.toLocaleString()}`;
    await reporter.finalize(summary);
  } finally {
    endJob();
  }
}

export function registerCredits(bot, { getCfg }) {
  bot.command("credits", (ctx) => runCredits(ctx, { getCfg }));
}
