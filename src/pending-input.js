// Penyimpan state "lagi nunggu user ngetik value" per chat.
// Dipakai buat settings yang butuh input (API key, URL, domain, concurrency)
// dan count custom buat generate/signup.
//
// Satu chat cuma boleh punya 1 pending input aktif. Timeout 5 menit.
const STAGE_TIMEOUT = 5 * 60_000;
const store = new Map(); // chatId -> { kind, expireAt, meta }

export function setPending(chatId, kind, meta = {}) {
  store.set(chatId, { kind, meta, expireAt: Date.now() + STAGE_TIMEOUT });
}

export function getPending(chatId) {
  const p = store.get(chatId);
  if (!p) return null;
  if (p.expireAt < Date.now()) {
    store.delete(chatId);
    return null;
  }
  return p;
}

export function clearPending(chatId) {
  store.delete(chatId);
}
