// State 1 job aktif sekaligus. Modul level singleton — gampang di-share antar
// command handler tanpa wiring yang ribet.
let current = null;

export function getCurrentJob() {
  return current;
}

export function isJobActive() {
  return current !== null && !current.done;
}

// Buat job baru. Throw kalau ada job lain yang masih aktif.
export function startJob({ mode, total, ctx }) {
  if (isJobActive()) {
    const tag = `${current.mode} [${current.completed}/${current.total}]`;
    throw new Error(`Job lain lagi jalan: ${tag}. /cancel dulu.`);
  }
  const ac = new AbortController();
  current = {
    id: `${mode}_${Date.now().toString(36)}`,
    mode,
    total,
    completed: 0,
    results: [],
    abortController: ac,
    signal: ac.signal,
    chatId: ctx.chat?.id,
    startedAt: Date.now(),
    done: false,
  };
  return current;
}

export function endJob() {
  if (!current) return;
  current.done = true;
  current.endedAt = Date.now();
  // Biarin object-nya tetap ada untuk referensi log; auto-clear setelah 30s
  const ref = current;
  setTimeout(() => {
    if (current === ref) current = null;
  }, 30_000);
  // Untuk akses langsung lewat isJobActive, drop reference now:
  current = null;
}

export function abortJob(reason = "user cancel") {
  if (!current || current.done) return false;
  current.cancelReason = reason;
  current.abortController.abort();
  return true;
}

// Helper short-format untuk pesan "job lagi jalan"
export function describeCurrent() {
  if (!current) return "(none)";
  return `${current.mode} [${current.completed}/${current.total}]`;
}
