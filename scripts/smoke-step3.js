// Smoke test step 3 — pastikan semua service Playwright bisa di-load tanpa
// error syntax / import. Ga jalanin Chrome, cuma cek shape exports.
import { strict as assert } from "node:assert";

const { signupOne } = await import("../src/services/canva-signup.js");
const { loginOne } = await import("../src/services/canva-login.js");
const { checkOneCredits, sumCredits } = await import(
  "../src/services/leonardo-credits.js"
);
const helpers = await import("../src/services/playwright-helpers.js");

assert.equal(typeof signupOne, "function", "signupOne harus function");
assert.equal(typeof loginOne, "function", "loginOne harus function");
assert.equal(typeof checkOneCredits, "function", "checkOneCredits harus function");
assert.equal(typeof sumCredits, "function", "sumCredits harus function");

assert.equal(typeof helpers.maskEmail, "function");
assert.equal(typeof helpers.doLeonardoOAuth, "function");
assert.equal(typeof helpers.captureCreditsOnPage, "function");
assert.equal(typeof helpers.detectCanvaError, "function");
assert.equal(typeof helpers.joinCanvaBusiness, "function");
assert.equal(typeof helpers.extractLeonardoSession, "function");
assert.equal(typeof helpers.fetchCreditsViaToken, "function");
assert.equal(typeof helpers.randomProfile, "function");

// maskEmail spot check
assert.equal(helpers.maskEmail("john.doe@hubify.com"), "joh****@hu***.co***");
assert.equal(helpers.maskEmail("john.doe@hubify.me"), "joh****@hu***.m***");
assert.equal(helpers.maskEmail(""), "");
assert.equal(helpers.maskEmail(undefined), "");

// sumCredits spot check
const summary = sumCredits([
  { ok: true, credits: { apiCredit: 500, subscriptionTokens: 100, subscriptionModelTokens: 50 } },
  { ok: true, credits: { apiCredit: 250, subscriptionTokens: 0, subscriptionModelTokens: 0 } },
  { ok: false, error: "x" },
]);
assert.deepEqual(summary, {
  okCount: 2,
  failCount: 1,
  totalApi: 750,
  totalSubscriptionTokens: 100,
  totalModelTokens: 50,
});

console.log("✅ smoke step 3 lulus — semua services Playwright bisa di-import & exports OK");
