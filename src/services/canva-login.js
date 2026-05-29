// Canva login flow (single account, email yang udah ada).
// Beda dengan signup: ga klik "Sign up", langsung input email di /login.
// Email harus pakai domain Hubify-managed biar OTP bisa di-fetch.
//
// Argumen `opts`:
//   - cfg              config Telegraf-bot
//   - akun             nomor akun (1-based) untuk round-robin proxy
//   - email            email yang mau di-login
//   - joinBusiness     boolean — auto-join Canva Business
//   - enableLeonardo   boolean — Leonardo OAuth + extract token + cek credit
//   - signal           AbortSignal
//   - logger           progress detail per akun
import { chromium } from "playwright-core";
import { fetchOtp } from "./hubify.js";
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
const CANVA_LOGIN = "https://www.canva.com/login";

function checkAbort(signal) {
  if (signal?.aborted) throw new Error("aborted");
}

export async function loginOne({
  cfg,
  akun,
  email,
  joinBusiness = false,
  enableLeonardo = false,
  signal,
  logger = () => {},
}) {
  if (!email) throw new Error("email kosong");
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

  try {
    const ctx = await browser.newContext({
      viewport: { width: profile.window[0], height: profile.window[1] },
      deviceScaleFactor: profile.dsf,
      locale: "id-ID",
      timezoneId: "Asia/Jakarta",
    });
    const page = await ctx.newPage();
    logger(`Login: ${maskEmail(email)}`);

    // 1. Buka Canva login page
    checkAbort(signal);
    await page.goto(CANVA_LOGIN, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await pause(page, 1000, 2000);

    // 2. Klik "Continue with email" kalau ada
    await clickByText(
      page,
      /continue with email|lanjutkan dengan email|email/,
      8_000
    );

    // 3. Input email + submit
    const inputEl = page
      .locator('input[name="username"], input[type="email"]')
      .first();
    await inputEl.waitFor({ state: "visible", timeout: 10_000 });
    await typeHuman(page, inputEl, email);
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

    // 8. Optional join Canva Business (FIX: selalu buka invite + klik join)
    let businessJoined = false;
    if (joinBusiness && cfg.canvaBusinessUrl) {
      checkAbort(signal);
      logger("Join Canva Business");
      const joined = await joinCanvaBusiness(page, cfg.canvaBusinessUrl, {
        signal,
      });
      logger(joined ? "Business: OK" : "Business: tombol ga ketemu");
      businessJoined = true;
    }

    // 9. Optional Leonardo OAuth + extract token + cek credit
    let leonardoUserId = null;
    let leonardoBlock = null;
    let credits = null;
    if (enableLeonardo) {
      checkAbort(signal);
      logger("Leonardo OAuth");
      leonardoUserId = await doLeonardoOAuth(page, { signal });

      const session = await extractLeonardoSession(page);
      checkAbort(signal);
      logger("Cek credit Leonardo");
      const cap = await captureCreditsOnPage(page, { timeoutMs: 10_000 });
      credits = cap.credits;
      leonardoBlock = {
        accessToken: session?.accessToken ?? null,
        cognitoSub: session?.cognitoSub ?? null,
        creditRequest: cap.creditRequest ?? null,
      };
    }

    // 10. Save storageState (paling akhir, sudah include Leonardo session)
    const storageState = await ctx.storageState();

    const record = {
      email,
      loggedInAt: new Date().toISOString(),
      leonardoUserId,
      joinedBusiness: businessJoined,
      proxy: proxy ? maskProxy(proxy) : null,
      storageState,
    };
    if (leonardoBlock) {
      record.leonardo = leonardoBlock;
      record.credits = credits;
      record.creditsCheckedAt = credits ? new Date().toISOString() : null;
    }

    logger(`Done: ${maskEmail(email)}`);
    return {
      ok: true,
      email,
      leonardoUserId,
      businessJoined,
      credits,
      record,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
