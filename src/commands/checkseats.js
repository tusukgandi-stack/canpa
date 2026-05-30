// /checkseats — cek sisa seat tiap link Canva Business.
// 1 akun checker (cfg.checkerEmail) login sekali, keliling tiap tim, baca
// jumlah anggota. Hasilnya juga di-reconcile ke config (counter `joined`).
import { checkSeats } from "../services/canva-seats.js";
import { reconcileJoins } from "../services/business.js";
import { endJob, isJobActive, startJob, detach } from "../jobs.js";
import { error as logError, scoped } from "../logger.js";

// Tampilkan URL ringkas biar pesan ga kepanjangan (host + ekor path).
function shortUrl(url) {
  try {
    const u = new URL(url);
    const tail = u.pathname.split("/").filter(Boolean).pop() || "";
    return `${u.host}/…/${tail.slice(0, 12)}`;
  } catch {
    return url.slice(0, 40);
  }
}

export async function runCheckSeats(ctx, { getCfg }) {
  if (isJobActive()) {
    return ctx.reply("Job lain lagi jalan. Batalin dulu (Cancel / /cancel).");
  }
  const cfg = await getCfg();
  if (!cfg.apiKey) {
    return ctx.reply("API key kosong. Set dulu lewat Settings atau /setapikey.");
  }
  if (!cfg.checkerEmail) {
    return ctx.reply(
      "checkerEmail belum di-set. Set akun checker dulu: /setchecker <email>\n" +
        "(email harus domain Hubify-managed biar OTP bisa di-fetch)"
    );
  }
  if (!cfg.canvaBusinessLinks?.length) {
    return ctx.reply("Belum ada link Business. Tambah dulu: /addlink <url>");
  }

  const job = startJob({ mode: "checkseats", total: cfg.canvaBusinessLinks.length, ctx });
  const log = scoped(`seats-${job.id.slice(-6)}`);
  const status = await ctx.reply("Cek seat... (login checker bisa makan waktu)");

  try {
    const { results } = await checkSeats({
      cfg,
      signal: job.signal,
      logger: (msg) => log.log(msg),
    });

    // Reconcile counter joined dari angka live (cuma yang berhasil kebaca).
    const counts = {};
    for (const r of results) {
      if (r.ok && Number.isFinite(r.joined)) counts[r.url] = r.joined;
    }
    await reconcileJoins(counts).catch(() => {});

    const seatLimit = cfg.canvaSeatLimit || 100;
    let totalRemaining = 0;
    const lines = results.map((r, i) => {
      if (r.ok) {
        totalRemaining += r.remaining;
        return `${i + 1}. ${shortUrl(r.url)}\n   ${r.joined}/${r.limit} anggota — sisa ${r.remaining}`;
      }
      return `${i + 1}. ${shortUrl(r.url)}\n   ✗ ${r.error}`;
    });

    const okCount = results.filter((r) => r.ok).length;
    const text =
      `Seat Canva Business (limit ${seatLimit}/tim)\n\n` +
      lines.join("\n") +
      `\n\nTotal sisa slot: ${totalRemaining} (${okCount}/${results.length} link kebaca)`;

    await ctx.telegram
      .editMessageText(status.chat.id, status.message_id, undefined, text)
      .catch(() => ctx.reply(text).catch(() => {}));
  } catch (err) {
    logError("seats", "fatal:", err);
    const msg = err?.message === "aborted" ? "Dibatalkan." : `Gagal: ${err.message}`;
    await ctx.telegram
      .editMessageText(status.chat.id, status.message_id, undefined, msg)
      .catch(() => ctx.reply(msg).catch(() => {}));
  } finally {
    endJob();
  }
}

export function registerCheckSeats(bot, { getCfg }) {
  bot.command("checkseats", (ctx) => detach(() => runCheckSeats(ctx, { getCfg })));
}
