// Smoke test fetchOtp baseline — verifikasi bot TOLAK OTP lama dan tunggu yang
// fresh (bug: bot narik OTP lama yg nyangkut di inbox sebelum OTP baru nyampe).
// Mock globalThis.fetch buat simulasi endpoint Hubify /otp.
import { strict as assert } from "node:assert";
import { fetchOtp, peekOtpTimestamp } from "../src/services/hubify.js";

const realFetch = globalThis.fetch;
function jsonResponse(obj) {
  return { ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) };
}

// Helper: bikin mock fetch yg balikin urutan response /otp yg di-set.
function mockOtpSequence(sequence) {
  let i = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/otp")) {
      const step = sequence[Math.min(i, sequence.length - 1)];
      i++;
      return jsonResponse({ success: true, data: step });
    }
    return realFetch(url);
  };
  return () => i; // return jumlah call
}

try {
  console.log("== peekOtpTimestamp: ada OTP lama → return receivedAt ==");
  {
    mockOtpSequence([{ otp: "111111", receivedAt: "2026-05-30T10:00:00.000Z" }]);
    const ts = await peekOtpTimestamp("key", "a@hubify.me");
    assert.equal(ts, "2026-05-30T10:00:00.000Z");
    console.log("  ok");
  }

  console.log("== peekOtpTimestamp: inbox kosong → null ==");
  {
    mockOtpSequence([{ otp: null }]);
    const ts = await peekOtpTimestamp("key", "a@hubify.me");
    assert.equal(ts, null);
    console.log("  ok");
  }

  console.log("== fetchOtp TOLAK OTP lama, tunggu yg fresh ==");
  {
    const baseline = "2026-05-30T10:00:00.000Z";
    // poll 1-2: masih OTP lama (sama dgn baseline) → harus di-skip
    // poll 3: OTP fresh (lebih baru) → harus diterima
    mockOtpSequence([
      { otp: "111111", receivedAt: "2026-05-30T10:00:00.000Z" }, // == baseline, tolak
      { otp: "111111", receivedAt: "2026-05-30T10:00:00.000Z" }, // tolak lagi
      { otp: "999999", receivedAt: "2026-05-30T10:01:30.000Z" }, // fresh, terima
    ]);
    const code = await fetchOtp("key", "a@hubify.me", {
      timeoutMs: 5_000,
      intervalMs: 10, // cepetin test
      after: baseline,
    });
    assert.equal(code, "999999", `harus narik OTP fresh, bukan lama. got: ${code}`);
    console.log("  ok");
  }

  console.log("== fetchOtp tanpa baseline → terima OTP pertama (backward compat) ==");
  {
    mockOtpSequence([{ otp: "555555", receivedAt: "2026-05-30T09:00:00.000Z" }]);
    const code = await fetchOtp("key", "a@hubify.me", { timeoutMs: 2_000, intervalMs: 10 });
    assert.equal(code, "555555");
    console.log("  ok");
  }

  console.log("== fetchOtp baseline tapi OTP ga ada receivedAt → terima (jangan nyangkut) ==");
  {
    mockOtpSequence([{ otp: "777777" }]); // ga ada receivedAt
    const code = await fetchOtp("key", "a@hubify.me", {
      timeoutMs: 2_000,
      intervalMs: 10,
      after: "2026-05-30T10:00:00.000Z",
    });
    assert.equal(code, "777777");
    console.log("  ok");
  }

  console.log("== fetchOtp cuma ada OTP lama terus → timeout (null) ==");
  {
    mockOtpSequence([{ otp: "111111", receivedAt: "2026-05-30T10:00:00.000Z" }]);
    const code = await fetchOtp("key", "a@hubify.me", {
      timeoutMs: 100,
      intervalMs: 20,
      after: "2026-05-30T10:00:00.000Z",
    });
    assert.equal(code, null, "OTP lama terus → harus timeout, bukan narik yg lama");
    console.log("  ok");
  }

  console.log("\n✅ smoke otp lulus — baseline tolak OTP lama, tunggu fresh");
} finally {
  globalThis.fetch = realFetch;
}
