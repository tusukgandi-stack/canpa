// /generate <n> — full flow: signup Canva + Leonardo + cek credit.
// Logic inti di runGenerate() supaya bisa dipanggil dari slash command & menu.
import { rebuildEmailsFile, saveAccount } from "../services/accounts.js";
import { signupOne } from "../services/canva-signup.js";
import { runWithConcurrency } from "../services/concurrency.js";
import { maskEmail } from "../services/playwright-helpers.js";
import { shortError } from "../error-format.js";
import { endJob, isJobActive, startJob } from "../jobs.js";
import { error as logError, scoped } from "../logger.js";
import { ProgressReporter } from "../progress.js";

function fmtCredit(c) {
  if (!c) return "?";
  const parts = [`${(c.apiCredit ?? 0).toLocaleString()} credit`];
  if (c.subscriptionTokens) {
    parts.push(`${c.subscriptionTokens.toLocaleString()} tokens`);
  }
  if (c.subscriptionModelTokens) {
    parts.push(`${c.subscriptionModelTokens.toLocaleString()} model`);
  }
  return parts.join(" · ");
}

// Inti job generate. n = jumlah akun.
export async function runGenerate(ctx, n, { getCfg }) {
  const cfg = await getCfg();
  if (!cfg.apiKey) {
    return ctx.reply("API key kosong. Set dulu lewat Settings atau /setapikey.");
  }
  if (isJobActive()) {
    return ctx.reply("Job lain lagi jalan. Batalin dulu (Cancel / /cancel).");
  }

  const job = startJob({ mode: "generate", total: n, ctx });
  const reporter = new ProgressReporter(ctx, n, "generate");
  await reporter.start();

  const log = scoped(`gen-${job.id.slice(-6)}`);
  log.log(`start total=${n} concurrency=${cfg.concurrency}`);

  const items = Array.from({ length: n }, (_, i) => i + 1);
  let succeed = 0;
  let totalCredit = 0;
  let totalTokens = 0;
  let totalModelTokens = 0;
  const done = []; // { email, credits } untuk summary akhir (unmasked)
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
            enableLeonardo: true,
            signal: job.signal,
            logger: (msg) => reporter.update(idx, `${lineFor(idx)} ${msg}`),
          });
          await saveAccount(result.record, "generate");
          succeed++;
          totalCredit += result.credits?.apiCredit ?? 0;
          totalTokens += result.credits?.subscriptionTokens ?? 0;
          totalModelTokens += result.credits?.subscriptionModelTokens ?? 0;
          done.push({ email: result.email, credits: result.credits });
          const credLabel = result.credits ? ` — ${fmtCredit(result.credits)}` : "";
          reporter.update(
            idx,
            `${lineFor(idx)} ✓ ${maskEmail(result.email)}${credLabel}`
          );
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

    await rebuildEmailsFile("generate").catch(() => {});

    const totalParts = [`${totalCredit.toLocaleString()} credit`];
    if (totalTokens) totalParts.push(`${totalTokens.toLocaleString()} tokens`);
    if (totalModelTokens)
      totalParts.push(`${totalModelTokens.toLocaleString()} model tokens`);

    const summary = job.signal.aborted
      ? `\nDibatalkan. ${succeed} akun yang selesai tetap ke-save.`
      : `\nSelesai: ${succeed}/${n} berhasil — Total ${totalParts.join(" · ")}`;
    await reporter.finalize(summary);

    // Kirim detail akun lengkap (email unmasked) biar ga perlu /list
    if (done.length) {
      const detail = done
        .map((d, i) => {
          const c = d.credits ? ` — ${fmtCredit(d.credits)}` : "";
          return `${i + 1}. ${d.email}${c}`;
        })
        .join("\n");
      await ctx
        .reply(`Detail akun (generate):\n\n${detail}`)
        .catch(() => {});
    }
  } catch (err) {
    logError("gen", "fatal:", err);
    await ctx.reply(`Job error: ${err.message}`).catch(() => {});
  } finally {
    endJob();
  }
}

export function registerGenerate(bot, { getCfg }) {
  bot.command("generate", async (ctx) => {
    const arg = ctx.message.text.split(" ")[1];
    const n = Math.min(Math.max(parseInt(arg) || 1, 1), 50);
    await runGenerate(ctx, n, { getCfg });
  });
}
