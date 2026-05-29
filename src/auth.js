// Middleware Telegraf whitelist owner. User di luar `cfg.ownerIds` di-ignore +
// di-log ke console (warn). Update id list bisa dilakukan dengan ngedit
// config.json dan restart bot.
import { warn } from "./logger.js";

export function ownerOnly(getCfg) {
  return async (ctx, next) => {
    const cfg = await getCfg();
    const uid = ctx.from?.id;
    if (!uid || !cfg.ownerIds?.includes(uid)) {
      warn(
        "auth",
        `Unauthorized: from=${uid} (@${ctx.from?.username || "n/a"}) chat=${ctx.chat?.id}`
      );
      try {
        await ctx.reply("Unauthorized. Bot ini single-user.");
      } catch {
        /* ignore */
      }
      return;
    }
    return next();
  };
}
