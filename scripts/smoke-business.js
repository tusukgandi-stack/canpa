// Smoke test multi-link Canva Business — logic murni (assign/commit/reconcile)
// + migrasi config. PAKAI folder temp terisolasi (env di-set SEBELUM import)
// supaya TIDAK PERNAH nyentuh config / accounts produksi user.
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { rm, writeFile, readFile } from "node:fs/promises";

const TEST_HOME = mkdtempSync(join(tmpdir(), "leobot-biz-"));
process.env.LEOBOT_ACCOUNTS_DIR = join(TEST_HOME, "accounts");
process.env.LEOBOT_CONFIG_FILE = join(TEST_HOME, "config.json");

const {
  assignLinks,
  linkCapacity,
  totalRemaining,
  commitJoins,
  reconcileJoins,
} = await import("../src/services/business.js");
const { loadConfig, saveConfig, CONFIG_FILE } = await import(
  "../src/services/config.js"
);

console.log("== linkCapacity + totalRemaining ==");
{
  const links = [
    { url: "a", joined: 100 },
    { url: "b", joined: 40 },
    { url: "c", joined: 0 },
  ];
  const cap = linkCapacity(links, 100);
  assert.deepEqual(
    cap.map((l) => l.remaining),
    [0, 60, 100]
  );
  assert.equal(totalRemaining(links, 100), 160);
  console.log("  ok");
}

console.log("== assignLinks fill-then-next ==");
{
  const links = [
    { url: "a", joined: 98 }, // sisa 2
    { url: "b", joined: 0 }, // sisa 100
  ];
  // minta 5: 2 ke a, 3 ke b
  const got = assignLinks(links, 100, 5);
  assert.deepEqual(got, ["a", "a", "b", "b", "b"]);
  console.log("  ok");
}

console.log("== assignLinks slot habis → null ==");
{
  const links = [{ url: "a", joined: 99 }]; // sisa 1
  const got = assignLinks(links, 100, 3);
  assert.deepEqual(got, ["a", null, null]);
  console.log("  ok");
}

console.log("== assignLinks tanpa link → semua null ==");
{
  const got = assignLinks([], 100, 2);
  assert.deepEqual(got, [null, null]);
  console.log("  ok");
}

console.log("== migrasi canvaBusinessUrl (string lama) → array ==");
{
  await writeFile(
    CONFIG_FILE,
    JSON.stringify({
      telegramToken: "x",
      ownerIds: [1],
      canvaBusinessUrl: "https://canva.com/brand/join?token=OLD",
    }),
    "utf8"
  );
  const cfg = await loadConfig();
  assert.equal(cfg.canvaBusinessLinks.length, 1);
  assert.equal(cfg.canvaBusinessLinks[0].url, "https://canva.com/brand/join?token=OLD");
  assert.equal(cfg.canvaBusinessLinks[0].joined, 0);
  assert.equal(cfg.canvaSeatLimit, 100);
  assert.equal(cfg.checkerEmail, "");
  assert.equal(cfg.canvaBusinessUrl, undefined, "field lama harus dihapus");
  console.log("  ok");
}

console.log("== normalizeLinks: array of string → array of object ==");
{
  await writeFile(
    CONFIG_FILE,
    JSON.stringify({
      telegramToken: "x",
      ownerIds: [1],
      canvaBusinessLinks: ["https://canva.com/a", { url: "https://canva.com/b", joined: 5 }],
    }),
    "utf8"
  );
  const cfg = await loadConfig();
  assert.equal(cfg.canvaBusinessLinks.length, 2);
  assert.deepEqual(cfg.canvaBusinessLinks[0], { url: "https://canva.com/a", joined: 0 });
  assert.deepEqual(cfg.canvaBusinessLinks[1], { url: "https://canva.com/b", joined: 5 });
  console.log("  ok");
}

console.log("== commitJoins nambah counter (1x tulis) ==");
{
  await saveConfig({
    telegramToken: "x",
    ownerIds: [1],
    canvaBusinessLinks: [
      { url: "https://canva.com/a", joined: 10 },
      { url: "https://canva.com/b", joined: 0 },
    ],
    canvaSeatLimit: 100,
  });
  await commitJoins({ "https://canva.com/a": 3, "https://canva.com/b": 5 });
  const cfg = await loadConfig();
  assert.equal(cfg.canvaBusinessLinks[0].joined, 13);
  assert.equal(cfg.canvaBusinessLinks[1].joined, 5);
  console.log("  ok");
}

console.log("== reconcileJoins set angka akurat ==");
{
  await reconcileJoins({ "https://canva.com/a": 38, "https://canva.com/b": 12 });
  const cfg = await loadConfig();
  assert.equal(cfg.canvaBusinessLinks[0].joined, 38);
  assert.equal(cfg.canvaBusinessLinks[1].joined, 12);
  console.log("  ok");
}

console.log("== seat limit invalid → default 100 ==");
{
  await writeFile(
    CONFIG_FILE,
    JSON.stringify({ telegramToken: "x", ownerIds: [1], canvaSeatLimit: -5 }),
    "utf8"
  );
  const cfg = await loadConfig();
  assert.equal(cfg.canvaSeatLimit, 100);
  console.log("  ok");
}

// ---------- cleanup ----------
console.log("\n== cleanup ==");
await rm(TEST_HOME, { recursive: true, force: true });
console.log("\n✅ smoke business lulus — multi-link assign + migrasi + commit/reconcile OK");
