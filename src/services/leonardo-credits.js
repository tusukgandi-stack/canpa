// Cek credit Leonardo.
// Strategi: (1) coba pakai access token tersimpan (cepat, tanpa browser).
//           (2) fallback buka browser pakai storageState kalau token expired.
import { chromium } from "playwright-core";
import { loadAccount, patchAccount } from "./accounts.js";
import { fetchCreditsViaToken } from "./playwright-helpers.js";

const TIMEOUT_MS = 15_000;

function normalizeCredits(ud) {
  return {
    apiCredit: ud.apiCredit ?? null,
    subscriptionTokens: ud.subscriptionTokens ?? null,
    subscriptionGptTokens: ud.subscriptionGptTokens ?? null,
    subscriptionModelTokens: ud.subscriptionModelTokens ?? null,
  };
}

// Cek 1 akun by email. Return { ok, credits, via } atau { ok: false, error }.
export async function checkOneCredits(email, { headless = true, signal } = {}) {
  const data = await loadAccount(email);
  if (!data) return { ok: false, email, error: "akun ga ada di disk" };
  if (signal?.aborted) return { ok: false, email, error: "aborted" };

  // ---- Jalur 1: token (cepat, no browser) ----
  const token = data.leonardo?.accessToken;
  const creditRequest = data.leonardo?.creditRequest;
  if (token && creditRequest?.url) {
    const ud = await fetchCreditsViaToken(creditRequest, token);
    if (ud && (ud.apiCredit !== undefined || ud.subscriptionTokens !== undefined)) {
      const credits = normalizeCredits(ud);
      await patchAccount(email, {
        credits,
        creditsCheckedAt: new Date().toISOString(),
      });
      return { ok: true, email, credits, via: "token" };
    }
    // token expired / gagal → lanjut ke fallback browser
  }

  // ---- Jalur 2: fallback browser pakai storageState ----
  if (!data.storageState) {
    return {
      ok: false,
      email,
      error: token ? "token expired & ga ada session" : "tidak ada session tersimpan",
    };
  }

  const browser = await chromium.launch({ channel: "chrome", headless });
  try {
    const ctx = await browser.newContext({
      storageState: data.storageState,
      locale: "id-ID",
      timezoneId: "Asia/Jakarta",
    });
    const page = await ctx.newPage();

    let captured = null;
    page.on("response", async (res) => {
      if (captured) return;
      const url = res.url();
      if (!url.includes("api.leonardo.ai") && !url.includes("/graphql")) return;
      try {
        const body = await res.json();
        const ud = body?.data?.users?.[0]?.user_details?.[0];
        if (ud && (ud.apiCredit !== undefined || ud.subscriptionTokens !== undefined)) {
          captured = ud;
        }
      } catch {
        /* not JSON */
      }
    });

    await page.goto("https://app.leonardo.ai/", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    const deadline = Date.now() + TIMEOUT_MS;
    while (!captured && Date.now() < deadline) {
      if (signal?.aborted) break;
      await page.waitForTimeout(500);
    }

    if (!captured) {
      return {
        ok: false,
        email,
        error: "credit info ga ke-capture (session expired?)",
      };
    }

    const credits = normalizeCredits(captured);
    await patchAccount(email, {
      credits,
      creditsCheckedAt: new Date().toISOString(),
    });
    return { ok: true, email, credits, via: "browser" };
  } catch (err) {
    return { ok: false, email, error: err.message };
  } finally {
    await browser.close().catch(() => {});
  }
}

// Sum-helper: agregasi hasil array
export function sumCredits(results) {
  let totalApi = 0;
  let totalSubs = 0;
  let totalModel = 0;
  let okCount = 0;
  let failCount = 0;
  for (const r of results) {
    if (r.ok && r.credits) {
      okCount++;
      totalApi += r.credits.apiCredit || 0;
      totalSubs += r.credits.subscriptionTokens || 0;
      totalModel += r.credits.subscriptionModelTokens || 0;
    } else {
      failCount++;
    }
  }
  return {
    okCount,
    failCount,
    totalApi,
    totalSubscriptionTokens: totalSubs,
    totalModelTokens: totalModel,
  };
}
