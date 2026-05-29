// Inline keyboard builders. Semua callback_data pakai prefix biar router
// gampang dispatch: "m:<action>", "n:<mode>:<count>", "s:<action>", "p:<action>".
import { Markup } from "telegraf";

// Preset jumlah akun untuk count picker
export const COUNT_PRESETS = [1, 3, 5, 10, 20];

// ===== Menu utama =====
export function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("⚡ Generate", "m:generate"), Markup.button.callback("📝 Signup", "m:signup")],
    [Markup.button.callback("🔑 Login", "m:login")],
    [Markup.button.callback("⚙️ Settings", "m:settings"), Markup.button.callback("🌐 Proxy", "m:proxy")],
    [
      Markup.button.callback("💳 Credits", "m:credits"),
      Markup.button.callback("📋 List", "m:list"),
      Markup.button.callback("📦 Download", "m:download"),
    ],
    [Markup.button.callback("📜 Log", "m:log"), Markup.button.callback("🛑 Cancel job", "m:cancel")],
  ]);
}

// ===== Count picker (untuk generate / signup) =====
// mode = "generate" | "signup"
export function countPicker(mode) {
  const row = COUNT_PRESETS.map((n) =>
    Markup.button.callback(String(n), `n:${mode}:${n}`)
  );
  return Markup.inlineKeyboard([
    row,
    [Markup.button.callback("✏️ Custom", `n:${mode}:custom`)],
    [Markup.button.callback("‹ Back", "m:home")],
  ]);
}

// ===== Confirm / Cancel (untuk login & aksi yang butuh konfirmasi) =====
export function confirmKeyboard(kind) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Confirm", `c:${kind}:yes`),
      Markup.button.callback("✖️ Cancel", `c:${kind}:no`),
    ],
  ]);
}

// ===== Settings menu =====
// cfg dipakai untuk nampilin state toggle di label tombol.
export function settingsMenu(cfg) {
  const onoff = (v) => (v ? "ON" : "OFF");
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("🔑 API Key", "s:set:apikey"),
      Markup.button.callback("🎨 Canva URL", "s:set:canva"),
    ],
    [
      Markup.button.callback("🌐 Domain", "s:set:domain"),
      Markup.button.callback("🧵 Concurrency", "s:set:conc"),
    ],
    [Markup.button.callback(`Headless: ${onoff(cfg.headless)}`, "s:toggle:headless")],
    [
      Markup.button.callback(
        `Leonardo (generate): ${onoff(cfg.modes.generate.enableLeonardo)}`,
        "s:toggle:gen_leo"
      ),
    ],
    [
      Markup.button.callback(
        `Leonardo (login): ${onoff(cfg.modes.login.enableLeonardo)}`,
        "s:toggle:login_leo"
      ),
      Markup.button.callback(
        `Join Business: ${onoff(cfg.modes.login.joinBusiness)}`,
        "s:toggle:login_biz"
      ),
    ],
    [Markup.button.callback("‹ Back", "m:home")],
  ]);
}

// ===== Proxy menu =====
export function proxyMenu(count) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`📃 List (${count})`, "p:list")],
    [
      Markup.button.callback("➕ Add", "p:add"),
      Markup.button.callback("🗑 Clear", "p:clear"),
    ],
    [Markup.button.callback("‹ Back", "m:home")],
  ]);
}

// Tombol balik ke menu utama (dipakai di hasil aksi)
export function backHome() {
  return Markup.inlineKeyboard([[Markup.button.callback("‹ Menu", "m:home")]]);
}
