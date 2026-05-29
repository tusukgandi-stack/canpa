// ProgressReporter — kirim 1 pesan awal terus edit isinya tiap akun update.
// Throttle minimal 1 detik antar edit + coalesce update yang berdekatan.
// Handle 429 (retry sekali) dan 400 "not modified" silently.
import { warn } from "./logger.js";

const MIN_EDIT_INTERVAL = 1000;

export class ProgressReporter {
  /**
   * @param {object} ctx Telegraf context
   * @param {number} total
   * @param {"generate"|"signup"|"login"} mode
   */
  constructor(ctx, total, mode) {
    this.ctx = ctx;
    this.total = total;
    this.mode = mode;
    this.lines = Array.from(
      { length: total },
      (_, i) => `[${i + 1}] ⏳ antri`
    );
    this.headerExtra = "";
    this.messageId = null;
    this.chatId = null;
    this.lastEdit = 0;
    this.pendingTimer = null;
    this._inflight = false;
    this._lastRendered = null;
  }

  // Panggil sekali di awal — kirim pesan pertama, simpan messageId.
  async start() {
    const first = await this.ctx.reply(this.render());
    this.messageId = first.message_id;
    this.chatId = first.chat.id;
    this._lastRendered = this.render();
    this.lastEdit = Date.now();
  }

  // Update baris akun ke-idx (0-based). Optionally update header.
  update(idx, text, headerExtra) {
    if (idx >= 0 && idx < this.lines.length) this.lines[idx] = text;
    if (headerExtra !== undefined) this.headerExtra = headerExtra;
    this._scheduleEdit();
  }

  // Edit pesan terakhir tanpa throttle (untuk finalize) — flush pending dulu.
  async finalize(extraSummary = "") {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    const text = this.render(extraSummary);
    await this._editNow(text);
  }

  render(extraSummary = "") {
    const header = this._header();
    const body = this.lines.join("\n");
    return [header, "", body, extraSummary].filter(Boolean).join("\n");
  }

  _header() {
    const done = this.lines.filter(
      (l) => l.includes("✅") || l.includes("❌")
    ).length;
    let label;
    if (this.mode === "generate") label = `🔄 Generating ${done}/${this.total}`;
    else if (this.mode === "signup") label = `🔄 Signup ${done}/${this.total}`;
    else label = `🔄 Login ${done}/${this.total}`;
    return [label, this.headerExtra].filter(Boolean).join("  ·  ");
  }

  _scheduleEdit() {
    if (this._inflight) return;
    const now = Date.now();
    const sinceLast = now - this.lastEdit;
    if (sinceLast >= MIN_EDIT_INTERVAL) {
      this._editNow(this.render()).catch(() => {});
    } else if (!this.pendingTimer) {
      this.pendingTimer = setTimeout(() => {
        this.pendingTimer = null;
        this._editNow(this.render()).catch(() => {});
      }, MIN_EDIT_INTERVAL - sinceLast);
    }
  }

  async _editNow(text) {
    if (!this.messageId) return;
    if (text === this._lastRendered) return; // dedup
    this._inflight = true;
    this.lastEdit = Date.now();
    try {
      await this.ctx.telegram.editMessageText(
        this.chatId,
        this.messageId,
        undefined,
        text
      );
      this._lastRendered = text;
    } catch (err) {
      const msg = String(err?.description || err?.message || err);
      if (/message is not modified/i.test(msg)) {
        // ignore — content sama persis
      } else if (err?.code === 429 && err?.parameters?.retry_after) {
        const sec = err.parameters.retry_after;
        warn("progress", `429: retry after ${sec}s`);
        await new Promise((r) => setTimeout(r, sec * 1000 + 250));
        try {
          await this.ctx.telegram.editMessageText(
            this.chatId,
            this.messageId,
            undefined,
            text
          );
          this._lastRendered = text;
        } catch (e2) {
          warn("progress", "retry edit gagal:", e2?.message);
        }
      } else {
        warn("progress", "edit gagal:", msg);
      }
    } finally {
      this._inflight = false;
    }
  }
}
