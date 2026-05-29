// Logger sederhana: console + in-memory ring buffer (200 line) untuk command /log.
// Format: [YYYY-MM-DD HH:mm:ss] [scope] message
const RING_SIZE = 200;
const ring = [];

function ts() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function push(line) {
  ring.push(line);
  if (ring.length > RING_SIZE) ring.shift();
}

function format(scope, level, msg) {
  return `[${ts()}] [${scope}] ${level ? `[${level}] ` : ""}${msg}`;
}

export function log(scope, ...args) {
  const msg = args
    .map((a) => (typeof a === "string" ? a : tryStringify(a)))
    .join(" ");
  const line = format(scope, "", msg);
  push(line);
  console.log(line);
}

export function warn(scope, ...args) {
  const msg = args.map((a) => (typeof a === "string" ? a : tryStringify(a))).join(" ");
  const line = format(scope, "warn", msg);
  push(line);
  console.warn(line);
}

export function error(scope, ...args) {
  const msg = args
    .map((a) => {
      if (a instanceof Error) return a.stack || a.message;
      return typeof a === "string" ? a : tryStringify(a);
    })
    .join(" ");
  const line = format(scope, "error", msg);
  push(line);
  console.error(line);
}

// Bikin scoped logger biar gampang: const l = scoped("gen-3"); l.log(...)
export function scoped(scope) {
  return {
    log: (...a) => log(scope, ...a),
    warn: (...a) => warn(scope, ...a),
    error: (...a) => error(scope, ...a),
  };
}

// Ambil N line terakhir
export function tail(n = 50) {
  return ring.slice(-Math.max(1, n));
}

// Untuk testing
export function _resetRing() {
  ring.length = 0;
}

function tryStringify(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
