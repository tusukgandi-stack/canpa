// /signup <n> — daftar akun Canva DOANG. No Business, no Leonardo, no credit.
// Logic inti di runSignup() supaya bisa dipanggil dari slash command & menu.
import { rebuildEmailsFile, saveAccount } from "../services/accounts.js";
import { signupOne } from "../services/canva-signup.js";
import { runWithConcurrency } from "../services/concurrency.js";
import { maskEmail } from "../services/playwright-helpers.js";
import { shortError } from "../error-format.js";
import { endJob, isJobActive, startJob } from "../jobs.js";
import { error as logError, scoped } from "../logger.js";
import { ProgressReporter } from "../progress.js";

export async function runSignup(ctx, n, { getCfg }) {
  const cfg = await getCfg();
  if (!cfg.apiKey) {
    return ctx.reply("API key kosong. Set dulu lewat Settings atau /setapikey.");
  }
  if (isJobActive()) {
    return ctx.reply("Job lain lagi jalan. Batalin dulu (Cancel / /cancel).");
  }

  const job = startJob({ mode: "signup", total: n, ctx });
  const reporter = new ProgressReporter(ctx, n, "signup");
  reporter.headerExtra = "Canva only";
  await reporter.start();

  const log = scoped(`signup-${job.id.slice(-6)}`);
  log.log(`start total=${n} (canva-only)`);

  const items = Array.from({ length: n }, (_, i) => i + 1);
  let succeed = 0;
  const done = [];
  const lineFor = (i) => `[${i + 1}]`;

  try {
    await runWithConcurrency(
      items,
      async (akun, idx) => {
        if (job.signal.aborted) {
          reporter.update(idx, `${lineFor(idx)} dibatalkan`);
          return;
        }
        reporter.update(idx, `${lineFor(idx)} mulai...`);
        try {
          const result = await signupOne({
            cfg,
            akun,
            enableLeonardo: false,
            signal: job.signal,
            logger: (msg) => reporter.update(idx, `${lineFor(idx)} ${msg}`),
          });
          await saveAccount(result.record, "signup");
          succeed++;
          done.push(result.email);
          reporter.update(idx, `${lineFor(idx)} ✓ ${maskEmail(result.email)}`);
          log.log(`[${akun}] OK ${result.email}`);
        } catch (err) {
          reporter.update(idx, `${lineFor(idx)} ✗ ${shortError(err)}`);
          log.warn(`[${akun}] FAIL ${err?.message}`);
        } finally {
          job.completed++;
        }
      },
      cfg.concurrency,
      job.signal
    );

    await rebuildEmailsFile("signup").catch(() => {});

    const summary = job.signal.aborted
      ? `\nDibatalkan. ${succeed} akun yang selesai tetap ke-save.`
      : `\nSelesai signup: ${succeed}/${n} berhasil (Canva only)`;
    await reporter.finalize(summary);

    if (done.length) {
      const detail = done.map((e, i) => `${i + 1}. ${e}`).join("\n");
      await ctx.reply(`Detail akun (signup):\n\n${detail}`).catch(() => {});
    }
  } catch (err) {
    logError("signup", "fatal:", err);
    await ctx.reply(`Job error: ${err.message}`).catch(() => {});
  } finally {
    endJob();
  }
}

export function registerSignup(bot, { getCfg }) {
  bot.command("signup", async (ctx) => {
    const arg = ctx.message.text.split(" ")[1];
    const n = Math.min(Math.max(parseInt(arg) || 1, 1), 50);
    await runSignup(ctx, n, { getCfg });
  });
}
