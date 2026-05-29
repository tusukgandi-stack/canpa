// Smoke test step 2 — services murni (no network).
// Dihapus / dipindah ke /scripts setelah lulus, atau dipakai sebagai
// referensi.
import { strict as assert } from "node:assert";
import { runWithConcurrency } from "../src/services/concurrency.js";
import {
  loadConfig,
  saveConfig,
  updateConfig,
  CONFIG_FILE,
} from "../src/services/config.js";
import {
  rebuildEmailsFile,
  saveAccount,
  scanAccounts,
} from "../src/services/accounts.js";
import {
  maskProxy,
  parseProxy,
  parseProxyList,
  pickProxy,
  toLaunchProxy,
  withUniqueSession,
} from "../src/services/proxy.js";

console.log("== proxy parsing ==");
assert.equal(parseProxy("1.2.3.4:8080"), "http://1.2.3.4:8080");
assert.equal(
  parseProxy("1.2.3.4:8080:user:pass"),
  "http://user:pass@1.2.3.4:8080"
);
assert.equal(parseProxy("user:pass@1.2.3.4:8080"), "http://user:pass@1.2.3.4:8080");
assert.equal(parseProxy("http://1.2.3.4:8080"), "http://1.2.3.4:8080");
assert.equal(
  parseProxy("socks5://u:p@host:1080"),
  "socks5://u:p@host:1080"
);
assert.equal(parseProxy("# komentar"), null);
assert.equal(parseProxy("invalid"), null);
console.log("  ok");

console.log("== proxy list parser ==");
const list = parseProxyList(
  "1.2.3.4:80\n# comment\nuser:pass@5.6.7.8:9090\n\nbroken\n"
);
assert.deepEqual(list, [
  "http://1.2.3.4:80",
  "http://user:pass@5.6.7.8:9090",
]);
console.log("  ok");

console.log("== mask + pickProxy ==");
const m = maskProxy("http://user:secret@1.2.3.4:8080");
assert.ok(m.includes("***"));
assert.ok(!m.includes("secret"));
assert.equal(pickProxy(list, 1), "http://user:pass@5.6.7.8:9090");
assert.equal(pickProxy(list, 5), "http://user:pass@5.6.7.8:9090"); // round robin
assert.equal(pickProxy([], 0), null);
console.log("  ok");

console.log("== toLaunchProxy + DataImpulse sticky ==");
const launch = toLaunchProxy("http://user:pass@gw.dataimpulse.com:823");
assert.equal(launch.server, "http://gw.dataimpulse.com:823");
assert.equal(launch.username, "user");
assert.equal(launch.password, "pass");

const stickyA = withUniqueSession(launch, 0);
const stickyB = withUniqueSession(launch, 1);
assert.ok(stickyA.username.startsWith("user__sessid.acc0_"));
assert.ok(stickyB.username.startsWith("user__sessid.acc1_"));
assert.notEqual(stickyA.username, stickyB.username);

// Non-DataImpulse → ga di-touch
const launchOther = toLaunchProxy("http://u:p@othergw.example:8080");
assert.equal(withUniqueSession(launchOther, 0).username, "u");

// Sudah ada __sessid → ga di-double
const launchSet = toLaunchProxy("http://u__sessid.foo:p@gw.dataimpulse.com:823");
assert.equal(withUniqueSession(launchSet, 0).username, "u__sessid.foo");
console.log("  ok");

console.log("== concurrency runner ==");
{
  const items = [10, 20, 30, 40, 50];
  const t0 = Date.now();
  const results = await runWithConcurrency(
    items,
    async (n) => {
      await new Promise((r) => setTimeout(r, n));
      return n * 2;
    },
    3
  );
  assert.equal(results.length, 5);
  assert.deepEqual(
    results.map((r) => r.value),
    [20, 40, 60, 80, 100]
  );
  // 3 paralel: kira-kira max(10+40, 20+50, 30) = ~70ms — beri toleransi
  console.log(`  ok (${Date.now() - t0}ms)`);
}

console.log("== concurrency abort ==");
{
  const ac = new AbortController();
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  const started = [];
  setTimeout(() => ac.abort(), 30);
  const results = await runWithConcurrency(
    items,
    async (n) => {
      started.push(n);
      await new Promise((r) => setTimeout(r, 50));
      return n;
    },
    2,
    ac.signal
  );
  const skipped = results.filter((r) => r.status === "skipped").length;
  assert.ok(skipped > 0, "harus ada slot yang skipped setelah abort");
  console.log(`  ok (skipped=${skipped})`);
}

console.log("== config load + update ==");
{
  const cfg = await loadConfig();
  assert.equal(typeof cfg.headless, "boolean");
  assert.deepEqual(cfg.modes.generate, { enableLeonardo: true });

  // Backup → mutate → restore
  const backup = JSON.stringify(cfg);
  await updateConfig((c) => {
    c.concurrency = 7;
    c.proxies = ["http://x:y@gw.dataimpulse.com:823"];
  });
  const reload = await loadConfig();
  assert.equal(reload.concurrency, 7);
  assert.equal(reload.proxies.length, 1);
  // Restore
  await saveConfig(JSON.parse(backup));
  console.log(`  ok (config: ${CONFIG_FILE})`);
}

console.log("== accounts save + scan ==");
{
  const fakeEmail = "smoketest+leobot@example.com";
  await saveAccount({
    email: fakeEmail,
    storageState: { cookies: [] },
    leonardoUserId: null,
    credits: 500,
  });
  const all = await scanAccounts();
  const found = all.find((r) => r.email === fakeEmail);
  assert.ok(found, "akun smoke-test harus ke-detect");
  assert.equal(found.credits, 500);
  await rebuildEmailsFile();

  // Cleanup
  const { unlink } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { ACCOUNTS_DIR } = await import("../src/services/config.js");
  await unlink(join(ACCOUNTS_DIR, `${fakeEmail}.json`)).catch(() => {});
  await rebuildEmailsFile();
  console.log("  ok");
}

console.log("\n✅ semua smoke-test step 2 lulus");
