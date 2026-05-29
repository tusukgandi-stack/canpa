// Worker pool sederhana — N task paralel.
// Returnnya array of { status, value | reason } sejajar dengan items.
// Mendukung AbortSignal: kalau abort, worker baru tidak diambil (yang sedang
// jalan tetap selesai, tapi worker function-nya yang harus cek `signal`).
export async function runWithConcurrency(items, worker, concurrency = 3, signal) {
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function loop() {
    while (true) {
      if (signal?.aborted) return;
      const i = nextIndex++;
      if (i >= items.length) return;
      try {
        results[i] = { status: "fulfilled", value: await worker(items[i], i) };
      } catch (err) {
        results[i] = { status: "rejected", reason: err };
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, loop));
  // Slot yang belum ke-isi (karena abort) di-mark "skipped"
  for (let i = 0; i < results.length; i++) {
    if (!results[i]) results[i] = { status: "skipped" };
  }
  return results;
}
