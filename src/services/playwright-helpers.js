// Helper umum untuk Playwright flows (Canva signup, login, Leonardo OAuth).
// Semua util di sini stateless & humanlike — random delay, type per char, dll.

export const PROFILES = [
  { window: [1366, 695], dsf: 1 },
  { window: [1440, 820], dsf: 1 },
  { window: [1536, 790], dsf: 1 },
  { window: [1728, 1020], dsf: 2 },
  { window: [1920, 985], dsf: 1 },
];

export const rand = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

export function randomProfile() {
  return PROFILES[rand(0, PROFILES.length - 1)];
}

// Mask email biar log-nya ga bocor: aliVis***@hub***.me
export function maskEmail(email) {
  if (!email?.includes("@")) return email || "";
  const [n, d] = email.split("@");
  const maskedName = n.length > 3 ? n.slice(0, 3) + "****" : n[0] + "****";
  const maskedDomain = d
    .split(".")
    .map((p) => (p.length > 2 ? p.slice(0, 2) + "***" : p[0] + "***"))
    .join(".");
  return `${maskedName}@${maskedDomain}`;
}

export async function pause(page, min = 100, max = 400) {
  await page.waitForTimeout(rand(min, max));
}

// Type per-char dengan random delay 30-80ms
export async function typeHuman(page, locator, text) {
  await locator.click();
  await pause(page, 100, 200);
  if (await locator.inputValue()) {
    await locator.fill("");
    await pause(page, 50, 150);
  }
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: rand(30, 80) });
  }
}

// Mouse wiggle sebelum klik untuk humanlike behavior
export async function wiggle(page, w = 1400, h = 800) {
  await page.mouse.move(rand(100, w - 100), rand(100, h - 100));
  await pause(page, 50, 150);
}

// Klik element berdasar regex text/href. Return true kalau ketemu, false kalau timeout.
export async function clickByText(page, matcher, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await wiggle(page);
    const ok = await page
      .evaluate((s) => {
        const el = [
          ...document.querySelectorAll("a, button, [role='button']"),
        ].find(
          (e) =>
            new RegExp(s, "i").test(e.textContent?.trim() || "") ||
            new RegExp(s, "i").test(e.getAttribute("href") || "")
        );
        if (!el) return false;
        el.click();
        return true;
      }, matcher.source)
      .catch(() => false);
    if (ok) {
      await pause(page, 200, 500);
      return true;
    }
    await page.waitForTimeout(500);
  }
  return false;
}

export async function clickSubmit(page) {
  const btn = page.locator('button[type="submit"]').first();
  await btn.waitFor({ state: "visible", timeout: 10000 });
  await wiggle(page);
  await pause(page, 100, 200);
  await btn.click();
  await pause(page, 300, 800);
}

// Mapping jenis error Canva → pesan yang jelas buat log/UI.
export const CANVA_ERR_MSG = {
  domain_blocked: "Domain email di-blok Canva (ganti domain Hubify)",
  ip_flagged: "IP/proxy ke-flag Canva",
  server_error: "Canva server error",
  canva_rejected: "Canva tolak pendaftaran",
};

// Deteksi jenis error Canva dari teks halaman. Return string kategori atau null.
// Dipakai di DUA titik: early (setelah submit email) + setelah submit OTP.
export async function detectCanvaError(page) {
  return page
    .evaluate(() => {
      const txt = document.body?.innerText || "";
      if (
        /email sementara|tidak dapat digunakan|temporary email|can'?t be used/i.test(
          txt
        )
      )
        return "domain_blocked";
      if (
        /alasan keamanan|security reasons|tidak dapa[t]? diproses|can'?t be processed/i.test(
          txt
        )
      )
        return "ip_flagged";
      if (
        /something went wrong|server error|try again later|coba lagi nanti|terjadi kesalahan|503|500|502|504/i.test(
          txt
        )
      )
        return "server_error";
      if (/\bRRS-[a-f0-9]+/i.test(txt)) return "canva_rejected";
      return null;
    })
    .catch(() => null);
}

// Throw error yang sudah dikategorikan kalau halaman nunjukin error Canva.
export async function assertNoCanvaError(page) {
  const kind = await detectCanvaError(page);
  if (kind) throw new Error(CANVA_ERR_MSG[kind] || CANVA_ERR_MSG.canva_rejected);
}

// Auto-join Canva Business — buka invite URL + klik tombol konfirmasi.
// FIX: SELALU buka invite (kecuali udah di brand/join). Bug lama skip kalau di
// canva.com/home, padahal Canva selalu redirect ke home dulu setelah signup.
// Return true kalau tombol join ke-klik (atau udah auto-joined).
export async function joinCanvaBusiness(page, inviteUrl, { signal } = {}) {
  if (!inviteUrl) return false;
  if (signal?.aborted) throw new Error("aborted");
  if (!page.url().toLowerCase().includes("brand/join")) {
    await page
      .goto(inviteUrl, { waitUntil: "domcontentloaded", timeout: 30_000 })
      .catch(() => {});
  }
  await pause(page, 1500, 2500);
  const joined = await clickByText(
    page,
    /gabung ke tim|gabung|join team|join|terima|accept/i,
    10_000
  );
  await pause(page, 1500, 2500);
  return joined;
}

// Leonardo OAuth dengan retry. Banyak kegagalan "persist:user kosong" itu
// transient (Leonardo lemot / hydration telat), jadi 1x retry naikin success
// rate signifikan. Return leonardoUserId atau throw setelah semua attempt habis.
export async function doLeonardoOAuth(page, { signal, attempts = 2 } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    if (signal?.aborted) throw new Error("aborted");
    try {
      return await doLeonardoOAuthOnce(page, { signal });
    } catch (err) {
      lastErr = err;
      if (err?.message === "aborted") throw err;
      if (i < attempts) await pause(page, 1500, 2500); // jeda sebelum retry
    }
  }
  throw lastErr;
}

// Satu kali percobaan OAuth. FIX: retry klik tombol "Canva" sampai URL navigasi
// ke consent canva.com, BARU cari tombol Allow.
async function doLeonardoOAuthOnce(page, { signal } = {}) {
  if (signal?.aborted) throw new Error("aborted");
  await page.goto("https://app.leonardo.ai/auth/login", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await pause(page, 1000, 1500);

  // 1. Klik "Canva" + retry sampai navigasi ke consent page canva.com
  const canvaBtn = page.locator('button:has-text("Canva")').first();
  await canvaBtn.waitFor({ state: "visible", timeout: 20_000 });
  let onConsent = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (signal?.aborted) throw new Error("aborted");
    try {
      await canvaBtn.click({ timeout: 5_000 });
    } catch {
      /* tombol mungkin udah ke-detach saat navigasi mulai */
    }
    try {
      await page.waitForURL(/canva\.com\/.*(oauth|authorize)/i, {
        timeout: 10_000,
      });
      onConsent = true;
      break;
    } catch {
      await pause(page, 1000, 1500);
    }
  }
  if (!onConsent) {
    throw new Error("Leonardo OAuth gagal (tombol Canva ga navigasi ke consent)");
  }

  // 2. Klik Allow di consent page
  if (signal?.aborted) throw new Error("aborted");
  await pause(page, 800, 1500);
  const allowBtn = page
    .locator('button:has-text("Allow"), button:has-text("Izinkan")')
    .first();
  await allowBtn.waitFor({ state: "visible", timeout: 20_000 });
  await allowBtn.click();

  // 3. Tunggu redirect balik ke Leonardo
  await page
    .waitForURL(/app\.leonardo\.ai/i, { timeout: 30_000 })
    .catch(() => {});
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await pause(page, 1000, 1500);

  // 4. Validasi sukses: persist:user punya id
  let leonardoUserId = null;
  try {
    leonardoUserId = await page
      .waitForFunction(
        () => {
          const r = localStorage.getItem("persist:user");
          if (!r) return null;
          try {
            const id = (JSON.parse(r).id || "").replace(/"/g, "");
            return id || null;
          } catch {
            return null;
          }
        },
        { timeout: 30_000 }
      )
      .then((h) => h.jsonValue());
  } catch {
    throw new Error("Leonardo OAuth gagal (persist:user kosong)");
  }
  if (!leonardoUserId) throw new Error("Leonardo user ID kosong");
  return leonardoUserId;
}

// Ambil access token Leonardo dari halaman (same-origin fetch).
// Disimpan di file akun biar cek credit nanti ga perlu buka browser.
// Return { accessToken, cognitoSub } atau null.
export async function extractLeonardoSession(page) {
  try {
    return await page.evaluate(async () => {
      const r = await fetch("/api/auth/get-session");
      if (!r.ok) return null;
      const d = await r.json();
      return {
        accessToken: d?.session?.accessToken || null,
        cognitoSub: d?.session?.cognitoSub || null,
      };
    });
  } catch {
    return null;
  }
}

// Capture credit + request GraphQL aslinya, PAKAI TAB YANG SAMA (tinggal reload).
// FIX: jangan buka tab baru (bikin "buka Leonardo 2x" yang membingungkan).
// Return { credits, creditRequest } — keduanya bisa null kalau ga ke-capture.
export async function captureCreditsOnPage(page, { timeoutMs = 10_000 } = {}) {
  let captured = null;
  let creditRequest = null;
  const onResp = async (res) => {
    if (captured) return;
    const url = res.url();
    if (!url.includes("api.leonardo.ai") && !url.includes("/graphql")) return;
    try {
      const body = await res.json();
      const ud = body?.data?.users?.[0]?.user_details?.[0];
      if (ud && (ud.apiCredit !== undefined || ud.subscriptionTokens !== undefined)) {
        captured = ud;
        const req = res.request();
        creditRequest = {
          url,
          method: req.method(),
          postData: req.postData() || null,
        };
      }
    } catch {
      /* response bukan JSON / partial */
    }
  };

  page.on("response", onResp);
  try {
    await page
      .goto("https://app.leonardo.ai/", {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      })
      .catch(() => {});
    const deadline = Date.now() + timeoutMs;
    while (!captured && Date.now() < deadline) {
      await page.waitForTimeout(500);
    }
  } finally {
    page.off("response", onResp);
  }

  const credits = captured
    ? {
        apiCredit: captured.apiCredit ?? null,
        subscriptionTokens: captured.subscriptionTokens ?? null,
        subscriptionGptTokens: captured.subscriptionGptTokens ?? null,
        subscriptionModelTokens: captured.subscriptionModelTokens ?? null,
      }
    : null;
  return { credits, creditRequest };
}

// Cek credit standalone via token (cepat, no browser).
// Return user_details object atau null kalau token expired / gagal.
export async function fetchCreditsViaToken(creditRequest, token) {
  if (!creditRequest?.url || !token) return null;
  try {
    const res = await fetch(creditRequest.url, {
      method: creditRequest.method || "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: creditRequest.postData || undefined,
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.data?.users?.[0]?.user_details?.[0] || null;
  } catch {
    return null;
  }
}
