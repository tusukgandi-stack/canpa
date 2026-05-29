// Smoke test playwright-helpers setelah update changelog.
import { strict as assert } from "node:assert";
const h = await import("../src/services/playwright-helpers.js");

// Exports baru harus ada
for (const fn of [
  "detectCanvaError",
  "assertNoCanvaError",
  "joinCanvaBusiness",
  "doLeonardoOAuth",
  "extractLeonardoSession",
  "captureCreditsOnPage",
  "fetchCreditsViaToken",
  "maskEmail",
  "clickByText",
  "clickSubmit",
  "typeHuman",
  "pause",
  "randomProfile",
]) {
  assert.equal(typeof h[fn], "function", `${fn} harus function`);
}

// hasCanvaError lama harus SUDAH dihapus (diganti detectCanvaError)
assert.equal(h.hasCanvaError, undefined, "hasCanvaError lama harus dihapus");
// captureLeonardoCredits lama harus SUDAH dihapus (diganti captureCreditsOnPage)
assert.equal(
  h.captureLeonardoCredits,
  undefined,
  "captureLeonardoCredits lama harus dihapus"
);

// CANVA_ERR_MSG mapping lengkap
assert.equal(typeof h.CANVA_ERR_MSG, "object");
for (const k of ["domain_blocked", "ip_flagged", "server_error", "canva_rejected"]) {
  assert.ok(h.CANVA_ERR_MSG[k], `CANVA_ERR_MSG.${k} harus ada`);
}

// === detectCanvaError dengan fake page ===
function fakePage(bodyText) {
  return {
    evaluate: async (fn) => fn.call(null),
    // emulate document.body.innerText via global shim
  };
}
// Karena evaluate jalan di "browser", kita simulasi dengan global document.
globalThis.document = { body: { innerText: "" } };
const pageEval = {
  evaluate: async (fn) => {
    try {
      return fn();
    } catch {
      return null;
    }
  },
};

async function detectWith(text) {
  globalThis.document.body.innerText = text;
  return h.detectCanvaError(pageEval);
}

assert.equal(await detectWith("Email sementara tidak dapat digunakan"), "domain_blocked");
assert.equal(await detectWith("This temporary email can't be used"), "domain_blocked");
assert.equal(await detectWith("Untuk alasan keamanan kami tidak dapat memproses"), "ip_flagged");
assert.equal(await detectWith("For security reasons this can't be processed"), "ip_flagged");
assert.equal(await detectWith("Something went wrong, try again later"), "server_error");
assert.equal(await detectWith("Error 503 service unavailable"), "server_error");
assert.equal(await detectWith("Reference: RRS-3fa9c2"), "canva_rejected");
assert.equal(await detectWith("Welcome to Canva! Your design awaits"), null);

// assertNoCanvaError: throw kalau ada error, diam kalau aman
let threw = false;
globalThis.document.body.innerText = "something went wrong";
try {
  await h.assertNoCanvaError(pageEval);
} catch (e) {
  threw = true;
  assert.match(e.message, /server error/i);
}
assert.ok(threw, "assertNoCanvaError harus throw saat ada error");

globalThis.document.body.innerText = "Halaman normal";
await h.assertNoCanvaError(pageEval); // ga boleh throw

// === fetchCreditsViaToken ===
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  assert.match(opts.headers.authorization, /^Bearer /);
  return {
    ok: true,
    json: async () => ({
      data: { users: [{ user_details: [{ apiCredit: 500, subscriptionTokens: 8500 }] }] },
    }),
  };
};
const ud = await h.fetchCreditsViaToken(
  { url: "https://api.leonardo.ai/v1/graphql", method: "POST", postData: "{}" },
  "fake-token"
);
assert.equal(ud.apiCredit, 500);
assert.equal(ud.subscriptionTokens, 8500);

// token kosong / no request → null
assert.equal(await h.fetchCreditsViaToken(null, "tok"), null);
assert.equal(await h.fetchCreditsViaToken({ url: "x" }, null), null);

globalThis.fetch = realFetch;
delete globalThis.document;

console.log("✅ smoke helpers lulus — detectCanvaError, OAuth, token, credits OK");
