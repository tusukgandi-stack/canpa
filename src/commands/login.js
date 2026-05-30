// /login — login akun yang udah ada.
// Flow: user mulai login (slash / tombol) → bot minta daftar email (reply text
// atau .txt). User kasih → bot validasi + preview + tombol Confirm/Cancel.
// Confirm → mulai job login.
import { rebuildEmailsFile, saveAccount } from "../services/accounts.js";
import { loginOne } from "../services/canva-login.js";
import { runWithConcurrency } from "../services/concurrency.js";
import { maskEmail } from "../services/playwright-helpers.js";
import { shortError } from "../error-format.js";
import { endJob, isJobActive, startJob } from "../jobs.js";
import { error as logError, scoped } from "../logger.js";
import { ProgressReporter } from "../progress.js";
import { confirmKeyboard } from "../keyboards.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STAGE_TIMEOUT = 5 * 60_000;

// Per-chat pending session: { stage, emails, expireAt }
const pending = new Map();

function parseEmails(text) {
  if (!text) return [];
  const out = [];
  for (const raw of text.split(/[\r\n,;]+/)) {
    const e = raw.trim();
    if (e && EMAIL_RE.test(e)) out.push(e);
  }
  return [...new Set(out)];
}

function sessionExpired(s) {
  return !s || s.expireAt < Date.now();
}

// Mulai prompt login — dipanggil dari /login dan tombol menu "Login".
export async function startLoginPrompt(ctx, { getCfg }) {
  if (isJobActive()) {
    return ctx.reply("Job lain lagi jalan. Batalin dulu (Cancel / /cancel).");
  }
  const cfg = await getCfg();
  if (!cfg.apiKey) {
    return ctx.reply("API key kosong. Set dulu lewat Settings atau /setapikey.");
  }
  pending.set(ctx.chat.id, {
    stage: "await_emails",
    emails: [],
    expireAt: Date.now() + STAGE_TIMEOUT,
  });
  await ctx.reply(
    "Kirim daftar email (1 per baris) atau attach file .txt.\n" +
      "Email harus pakai domain Hubify-managed biar OTP bisa di-fetch.\n\n" +
      "Timeout 5 menit. Ketik /cancel buat batalin."
  );
}

function previewText(emails) {
  return (
    `Akan login ${emails.length} akun:\n` +
    emails
      .slice(0, 10)
      .map((e, i) => `${i + 1}. ${e}`)
      .join("\n") +
    (emails.length > 10 ? `\n... (+${emails.length - 10})` : "")
  );
}

// Jalankan job login untuk daftar email. Dipanggil dari /confirm & tombol Confirm.
export async function runLoginJob(ctx, emails, { getCfg }) {
  if (isJobActive()) {
    return ctx.reply("Job lain lagi jalan. Batalin dulu (Cancel / /cancel).");
  }
  const cfg = await getCfg();
  const enableLeonardo = !!cfg.modes.login.enableLeonardo;
  const joinBusiness = !!cfg.modes.login.joinBusiness;

  const job = startJob({ mode: "login", total: emails.length, ctx });
  const reporter = new ProgressReporter(ctx, emails.length, "login");
  reporter.headerExtra = `Leonardo: ${enableLeonardo ? "ON" : "OFF"} · Business: ${joinBusiness ? "ON" : "OFF"}`;
  await reporter.start();

  const log = scoped(`login-${job.id.slice(-6)}`);
  log.log(
    `start total=${emails.length} leonardo=${enableLeonardo} business=${joinBusiness}`
  );

  let succeed = 0;
  const done = []; // { email, businessJoined, leonardo }
  const lineFor = (i) => `[${i + 1}]`;

  try {
    await runWithConcurrency(
      emails,
      async (email, idx) => {
        if (job.signal.aborted) {
          reporter.update(idx, `${lineFor(idx)} dibatalkan`);
          return;
        }
        reporter.update(idx, `${lineFor(idx)} mulai...`);
        try {
          const result = await loginOne({
            cfg,
            akun: idx + 1,
            email,
            joinBusiness,
            enableLeonardo,
            signal: job.signal,
            logger: (msg) => reporter.update(idx, `${lineFor(idx)} ${msg}`),
          });
          await saveAccount(result.record, "login");
          succeed++;
          const flags = [];
          if (result.businessJoined) flags.push("Business");
          if (result.leonardoUserId) flags.push("Leonardo");
          done.push({ email, flags });
          reporter.update(
            idx,
            `${lineFor(idx)} ✓ ${maskEmail(email)}${flags.length ? ` — ${flags.join(" + ")}` : ""}`
          );
          log.log(`[${idx + 1}] OK ${email}`);
        } catch (err) {
          reporter.update(idx, `${lineFor(idx)} ✗ ${shortError(err)}`);
          log.warn(`[${idx + 1}] FAIL ${err?.message}`);
        } finally {
          job.completed++;
        }
      },
      cfg.concurrency,
      job.signal
    );

    await rebuildEmailsFile("login").catch(() => {});
    const summary = job.signal.aborted
      ? `\nDibatalkan. ${succeed} akun yang selesai tetap ke-save.`
      : `\nLogin: ${succeed}/${emails.length} berhasil`;
    await reporter.finalize(summary);

    if (done.length) {
      const detail = done
        .map(
          (d, i) =>
            `${i + 1}. ${d.email}${d.flags.length ? ` — ${d.flags.join(" + ")}` : ""}`
        )
        .join("\n");
      await ctx.reply(`Detail akun (login):\n\n${detail}`).catch(() => {});
    }
  } catch (err) {
    logError("login", "fatal:", err);
    await ctx.reply(`Job error: ${err.message}`).catch(() => {});
  } finally {
    endJob();
  }
}

// Ambil emails yang udah di-confirm untuk chat ini (dipakai callback Confirm).
export function takePendingEmails(chatId) {
  const s = pending.get(chatId);
  if (!s || sessionExpired(s) || s.stage !== "await_confirm") return null;
  pending.delete(chatId);
  return s.emails;
}

export function clearPending(chatId) {
  pending.delete(chatId);
}

export function registerLogin(bot, { getCfg }) {
  bot.command("login", (ctx) => startLoginPrompt(ctx, { getCfg }));

  // Tangkap text/document saat stage await_emails
  bot.on("message", async (ctx, next) => {
    const session = pending.get(ctx.chat?.id);
    if (!session) return next();
    if (sessionExpired(session)) {
      pending.delete(ctx.chat.id);
      return next();
    }
    if (session.stage !== "await_emails") return next();

    // Document?
    if (ctx.message.document) {
      const doc = ctx.message.document;
      if (
        !doc.file_name?.toLowerCase().endsWith(".txt") &&
        !doc.mime_type?.includes("text")
      ) {
        return next();
      }
      try {
        const link = await ctx.telegram.getFileLink(doc.file_id);
        const res = await fetch(link.toString());
        const text = await res.text();
        const emails = parseEmails(text);
        if (!emails.length) return ctx.reply("Tidak ada email valid di file.");
        session.emails = emails;
        session.stage = "await_confirm";
        session.expireAt = Date.now() + STAGE_TIMEOUT;
        return ctx.reply(previewText(emails), confirmKeyboard("login"));
      } catch (err) {
        return ctx.reply(`Gagal load file: ${err.message}`);
      }
    }

    // Plain text (bukan command)
    if (ctx.message.text && !ctx.message.text.startsWith("/")) {
      const emails = parseEmails(ctx.message.text);
      if (!emails.length) {
        return ctx.reply("Tidak ada email valid. Coba lagi atau /cancel.");
      }
      session.emails = emails;
      session.stage = "await_confirm";
      session.expireAt = Date.now() + STAGE_TIMEOUT;
      return ctx.reply(previewText(emails), confirmKeyboard("login"));
    }

    return next();
  });

  // /confirm (slash) — setara tombol Confirm
  bot.command("confirm", async (ctx) => {
    const emails = takePendingEmails(ctx.chat.id);
    if (!emails) {
      return ctx.reply("Tidak ada email yang siap di-confirm. Mulai login dulu.");
    }
    await runLoginJob(ctx, emails, { getCfg });
  });
}
