// Entry point — load config → init bot → launch.
// Re-load config tiap kali bot.use middleware ngambil cfg supaya update via
// /setapikey dkk langsung berlaku tanpa restart.
import { mkdir } from "node:fs/promises";
import { ACCOUNTS_DIR, loadConfig, saveConfig } from "./src/services/config.js";
import { createBot } from "./src/bot.js";
import { error as logError, log } from "./src/logger.js";

async function main() {
  // Pastikan accounts/ ada
  await mkdir(ACCOUNTS_DIR, { recursive: true });

  let cfg = await loadConfig();

  // Auto-bikin config.json kalau belum ada (loadConfig return default kalau ga ada)
  await saveConfig(cfg).catch(() => {});

  if (!cfg.telegramToken) {
    console.error(
      "❌ telegramToken kosong di config.json. Edit dulu, baru restart:"
    );
    console.error("   1. Chat @BotFather → /newbot → copy token");
    console.error("   2. Chat @userinfobot → copy your user ID");
    console.error("   3. Edit config.json: telegramToken + ownerIds");
    process.exit(1);
  }
  if (!cfg.ownerIds?.length) {
    console.error(
      "❌ ownerIds kosong di config.json. Tambah Telegram user ID kamu dulu."
    );
    process.exit(1);
  }

  // getCfg re-load tiap dipanggil biar mutasi config langsung berlaku
  const getCfg = async () => loadConfig();

  const bot = createBot(cfg.telegramToken, { getCfg });

  log("bot", `Boot. owners=${cfg.ownerIds.join(",")}`);
  log("bot", `accounts dir: ${ACCOUNTS_DIR}`);

  // Launch (long-polling). Timeout 30s buat updates.
  await bot.launch();
}

// Graceful shutdown
process.once("SIGINT", () => process.exit(0));
process.once("SIGTERM", () => process.exit(0));

main().catch((err) => {
  logError("bot", "fatal:", err);
  process.exit(1);
});
