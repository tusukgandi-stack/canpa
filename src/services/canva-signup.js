// Canva signup flow (single account).
//   /generate  → enableLeonardo=true:  signup + join Business + Leonardo OAuth + cek credit
//   /signup    → enableLeonardo=false: signup Canva DOANG (no Business, no Leonardo)
//
// Returnnya structured result — caller (commands/generate.js, commands/signup.js)
// yang save ke disk. Service throw kalau gagal → caller skip save (akun gagal
// ga ke-save).
//
// Argumen `opts`:
//   - cfg                  config Telegraf-bot (apiKey, headless, dll)
//   - akun                 nomor akun (1-based) untuk round-robin proxy
//   - enableLeonardo       boolean — true = full flow (Business + Leonardo + credit)
//   - signal               AbortSignal untuk early-exit
//   - logger               opsional, fungsi (msg) => void untuk progress detail
import { chromium } from "playwright-core";
import { createInbox, deleteInbox, fetchOtp } from "./hubify.js";
import {
  maskProxy,
  pickProxy,
  toLaunchProxy,
  withUniqueSession,
} from "./proxy.js";
import {
  assertNoCanvaError,
  captureCreditsOnPage,
  clickByText,
  clickSubmit,
  doLeonardoOAuth,
  extractLeonardoSession,
  joinCanvaBusiness,
  maskEmail,
  pause,
  randomProfile,
  typeHuman,
} from "./playwright-helpers.js";

const OTP_TIMEOUT_MS = 20_000;
const OTP_POLL_MS = 2_000;
const CANVA_HOME = "https://www.canva.com/";

function checkAbort(signal) {
  if (signal?.aborted) throw new Error("aborted");
}

export async function signupOne({
  cfg,
  akun,
  enableLeonardo = false,
  signal,
  logger = () => {},
}) {
  if (!cfg.apiKey) throw new Error("Hubify API key kosong");
  checkAbort(signal);

  const profile = randomProfile();
  const proxy = pickProxy(cfg.proxies, akun - 1);
  const launchProxy = withUniqueSession(toLaunchProxy(proxy), akun);
  if (proxy) logger(`Proxy: ${maskProxy(proxy)}`);

  const browser = await chromium.launch({
    channel: "chrome",
    headless: cfg.headless,
    proxy: launchProxy || undefined,
    args: [
      `--window-size=${profile.window[0]},${profile.window[1]}`,
      "--disable-blink-features=AutomationControlled",
    ],
  });

  let inboxEmail = null;
  try {
    const ctx = await browser.newContext({
      viewport: { width: profile.window[0], height: profile.window[1] },
      deviceScaleFactor: profile.dsf,
      locale: "id-ID",
      timezoneId: "Asia/Jakarta",
    });
    const page = await ctx.newPage();

    // 1. Bikin inbox via Hubify
    checkAbort(signal);
    const inbox = await createInbox(cfg.apiKey, {
      domainId: cfg.domainId || undefined,
    });
    const email = inbox.email;
    inboxEmail = email;
    logger(`Email: ${maskEmail(email)}`);

    // 2. Buka Canva home, klik "Sign up"
    checkAbort(signal);
    await page.goto(CANVA_HOME, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await pause(page, 1000, 2000);

    let ready = false;
    for (let i = 0; i < 30; i++) {
      checkAbort(signal);
      ready = await page
        .evaluate(
          () =>
            /canva/i.test(document.title) &&
            /desain|design|daftar|masuk|sign up|log in/i.test(
              document.body?.innerText || ""
            )
        )
        .catch(() => false);
      if (ready) break;
      await page.waitForTimeout(1000);
    }
    if (!ready) throw new Error("Canva not ready");

    if (!(await clickByText(page, /^(sign up|daftar)$/))) {
      throw new Error("Tombol Sign up tidak ditemukan");
    }
    await clickByText(page, /continue with email|lanjutkan dengan email|email/);

    // 3. Input email + submit dua kali (continue → confirm)
    const inputEl = page
      .locator('input[name="username"], input[type="email"]')
      .first();
    await inputEl.waitFor({ state: "visible", timeout: 10_000 });
    await typeHuman(page, inputEl, email);
    await clickSubmit(page);
    await clickSubmit(page);

    // 4. Early error check (sebelum buang 20s nungguin OTP)
    checkAbort(signal);
    await pause(page, 1000, 1500);
    await assertNoCanvaError(page);

    // 5. Polling OTP via Hubify
    checkAbort(signal);
    logger(`Tunggu OTP (max ${OTP_TIMEOUT_MS / 1000}s)`);
    const code = await fetchOtp(cfg.apiKey, email, {
      timeoutMs: OTP_TIMEOUT_MS,
      intervalMs: OTP_POLL_MS,
      signal,
    });
    if (!code) throw new Error("OTP timeout");
    logger("OTP diterima");

    // 6. Submit OTP
    checkAbort(signal);
    const codeInput = page
      .locator(
        'input[name="code"], input[autocomplete="one-time-code"], input[inputmode="numeric"]'
      )
      .first();
    await codeInput.waitFor({ state: "visible", timeout: 15_000 });
    await typeHuman(page, codeInput, code);
    await pause(page, 500, 1000);
    await page.waitForLoadState("networkidle").catch(() => {});
    await pause(page, 1000, 2000);

    // 7. Error check lagi setelah OTP
    await assertNoCanvaError(page);

    // ====== /signup berhenti di sini (Canva-only) ======
    if (!enableLeonardo) {
      const storageState = await ctx.storageState();
      logger(`Done: ${maskEmail(email)}`);
      return {
        ok: true,
        email,
        leonardoUserId: null,
        credits: null,
        record: {
          email,
          createdAt: new Date().toISOString(),
          proxy: proxy ? maskProxy(proxy) : null,
          storageState,
        },
      };
    }

    // ====== /generate full flow ======
    // 8. Auto-join Canva Business (DULU, sebelum Leonardo) — FIX: selalu buka invite
    if (cfg.canvaBusinessUrl) {
      checkAbort(signal);
      logger("Join Canva Business");
      const joined = await joinCanvaBusiness(page, cfg.canvaBusinessUrl, {
        signal,
      });
      logger(joined ? "Business: OK" : "Business: tombol ga ketemu");
    }

    // 9. Leonardo OAuth
    checkAbort(signal);
    logger("Leonardo OAuth");
    const leonardoUserId = await doLeonardoOAuth(page, { signal });

    // 10. Extract token Leonardo (buat cek credit cepat tanpa browser nanti)
    const session = await extractLeonardoSession(page);

    // 11. Capture credit + request GraphQL (di tab yang sama)
    checkAbort(signal);
    logger("Cek credit Leonardo");
    const { credits, creditRequest } = await captureCreditsOnPage(page, {
      timeoutMs: 10_000,
    });

    // 12. storageState terakhir (sudah include Leonardo session)
    const storageState = await ctx.storageState();

    logger(`Done: ${maskEmail(email)}`);
    return {
      ok: true,
      email,
      leonardoUserId,
      credits,
      record: {
        email,
        createdAt: new Date().toISOString(),
        leonardoUserId,
        proxy: proxy ? maskProxy(proxy) : null,
        leonardo: {
          accessToken: session?.accessToken ?? null,
          cognitoSub: session?.cognitoSub ?? null,
          creditRequest: creditRequest ?? null,
        },
        credits,
        creditsCheckedAt: credits ? new Date().toISOString() : null,
        storageState,
      },
    };
  } finally {
    await browser.close().catch(() => {});
    if (inboxEmail && cfg.deleteInboxAfter) {
      await deleteInbox(cfg.apiKey, inboxEmail).catch(() => {});
    }
  }
}
