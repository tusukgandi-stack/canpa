// Cek sisa seat tiap link Canva Business.
//
// Cara kerja: 1 akun CHECKER (cfg.checkerEmail, Hubify-managed) login sekali,
// terus keliling tiap invite link → buka https://www.canva.com/settings/people
// → baca jumlah anggota tim. sisa = seatLimit - anggota.
//
// Session checker disimpan di accounts/_checker.json (di-skip scanAccounts
// karena prefix "_") biar cek berikutnya ga perlu OTP lagi. Kalau session
// expired (ke-redirect ke login), otomatis login ulang via OTP.
//
// Checker makan 1 seat per tim (dia ikut ke-hitung di angka anggota) — itu
// normal & bikin logikanya simpel.
import { chromium } from "playwright-core";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ACCOUNTS_DIR } from "./config.js";
import { fetchOtp, peekOtpTimestamp } from "./hubify.js";
import {
  maskProxy,
  pickProxy,
  toLaunchProxy,
  withUniqueSession,
} from "./proxy.js";
import {
  assertNoCanvaError,
  clickByText,
  clickSubmit,
  joinCanvaBusiness,
  maskEmail,
  pause,
  randomProfile,
  readTeamMemberCount,
  typeHuman,
} from "./playwright-helpers.js";

const OTP_TIMEOUT_MS = 30_000;
const OTP_POLL_MS = 2_000;
const CANVA_LOGIN = "https://www.canva.com/login";
const PEOPLE_URL = "https://www.canva.com/settings/people";
const CHECKER_FILE = join(ACCOUNTS_DIR, "_checker.json");

function checkAbort(signal) {
  if (signal?.aborted) throw new Error("aborted");
}

async function loadCheckerSession() {
  try {
    const raw = await readFile(CHECKER_FILE, "utf8");
    const data = JSON.parse(raw);
    return data.storageState || null;
  } catch {
    return null;
  }
}

async function saveCheckerSession(email, storageState) {
  await mkdir(ACCOUNTS_DIR, { recursive: true });
  await writeFile(
    CHECKER_FILE,
    JSON.stringify(
      { email, storageState, updatedAt: new Date().toISOString() },
      null,
      2
    ),
    "utf8"
  );
}

// Login checker via OTP (dipakai kalau belum ada session / session expired).
async function loginChecker(page, apiKey, email, { signal, logger }) {
  logger(`Login checker: ${maskEmail(email)}`);
  await page.goto(CANVA_LOGIN, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await pause(page, 1000, 2000);
  await clickByText(
    page,
    /continue with email|lanjutkan dengan email|email/,
    8_000
  );
  const inputEl = page
    .locator('input[name="username"], input[type="email"]')
    .first();
  await inputEl.waitFor({ state: "visible", timeout: 10_000 });
  await typeHuman(page, inputEl, email);
  const otpBaseline = await peekOtpTimestamp(apiKey, email);
  await clickSubmit(page);

  checkAbort(signal);
  await pause(page, 1000, 1500);
  await assertNoCanvaError(page);

  logger(`Tunggu OTP checker (max ${OTP_TIMEOUT_MS / 1000}s)`);
  const code = await fetchOtp(apiKey, email, {
    timeoutMs: OTP_TIMEOUT_MS,
    intervalMs: OTP_POLL_MS,
    signal,
    after: otpBaseline,
  });
  if (!code) throw new Error("OTP checker timeout");

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
  await assertNoCanvaError(page);
}

// Cek apakah halaman saat ini nyangkut di login (session expired).
async function isOnLogin(page) {
  if (/\/login|\/signup/i.test(page.url())) return true;
  return page
    .evaluate(() =>
      /masuk ke canva|log in to canva|continue with email|lanjutkan dengan email/i.test(
        document.body?.innerText || ""
      )
    )
    .catch(() => false);
}

/**
 * Cek seat semua link.
 * @param {object} opts
 * @param {object} opts.cfg            config (apiKey, checkerEmail, canvaBusinessLinks, canvaSeatLimit, headless, proxies)
 * @param {AbortSignal} opts.signal
 * @param {(msg:string)=>void} opts.logger
 * @returns {Promise<{ results: Array<{url, joined, limit, remaining, ok, error}>, email }>}
 */
export async function checkSeats({ cfg, signal, logger = () => {} }) {
  if (!cfg.apiKey) throw new Error("Hubify API key kosong");
  if (!cfg.checkerEmail) throw new Error("checkerEmail kosong — set dulu");
  const links = cfg.canvaBusinessLinks || [];
  if (!links.length) throw new Error("Belum ada link Business");
  const seatLimit = cfg.canvaSeatLimit || 100;
  checkAbort(signal);

  const profile = randomProfile();
  const proxy = pickProxy(cfg.proxies, 0);
  const launchProxy = withUniqueSession(toLaunchProxy(proxy), 1);
  if (proxy) logger(`Proxy: ${maskProxy(proxy)}`);

  const storageState = await loadCheckerSession();

  const browser = await chromium.launch({
    channel: "chrome",
    headless: cfg.headless,
    proxy: launchProxy || undefined,
    args: [
      `--window-size=${profile.window[0]},${profile.window[1]}`,
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const results = [];
  try {
    const ctx = await browser.newContext({
      viewport: { width: profile.window[0], height: profile.window[1] },
      deviceScaleFactor: profile.dsf,
      locale: "id-ID",
      timezoneId: "Asia/Jakarta",
      storageState: storageState || undefined,
    });
    const page = await ctx.newPage();

    // Validasi session: buka people page. Kalau ke-redirect login → login ulang.
    checkAbort(signal);
    await page
      .goto(PEOPLE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 })
      .catch(() => {});
    await pause(page, 1500, 2500);

    if (!storageState || (await isOnLogin(page))) {
      await loginChecker(page, cfg.apiKey, cfg.checkerEmail, { signal, logger });
    }

    // Keliling tiap link: join/switch tim → buka people → baca angka.
    for (let i = 0; i < links.length; i++) {
      checkAbort(signal);
      const { url } = links[i];
      logger(`Cek link ${i + 1}/${links.length}`);
      try {
        // Buka invite → pindah/aktifin tim ini. Kalau udah anggota, Canva
        // biasanya cuma buka tim (ga ada tombol join) — itu ga apa.
        // clickTimeout pendek (4s): checker udah member, jadi jarang ada tombol
        // join, ga perlu nunggu lama tiap tim.
        await joinCanvaBusiness(page, url, { signal, clickTimeoutMs: 4_000 }).catch(
          () => {}
        );
        await pause(page, 1200, 2000);

        // Buka halaman anggota tim yang aktif.
        await page
          .goto(PEOPLE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 })
          .catch(() => {});
        await pause(page, 1500, 2500);

        const count = await readTeamMemberCount(page);
        if (count == null) {
          results.push({
            url,
            joined: links[i].joined || 0,
            limit: seatLimit,
            remaining: null,
            ok: false,
            error: "angka anggota ga kebaca",
          });
        } else {
          results.push({
            url,
            joined: count,
            limit: seatLimit,
            remaining: Math.max(0, seatLimit - count),
            ok: true,
            error: null,
          });
        }
      } catch (err) {
        if (err?.message === "aborted") throw err;
        results.push({
          url,
          joined: links[i].joined || 0,
          limit: seatLimit,
          remaining: null,
          ok: false,
          error: err?.message || "error",
        });
      }
    }

    // Simpan session terbaru biar cek berikutnya ga perlu OTP.
    const freshState = await ctx.storageState();
    await saveCheckerSession(cfg.checkerEmail, freshState).catch(() => {});

    return { results, email: cfg.checkerEmail };
  } finally {
    await browser.close().catch(() => {});
  }
}
