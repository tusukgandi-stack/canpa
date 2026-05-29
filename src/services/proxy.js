// Parser & util proxy. Mendukung format:
//   host:port
//   host:port:user:pass
//   user:pass@host:port
//   http://host:port  /  http://user:pass@host:port
//   socks5://...
//
// Output `parseProxy` = URL string siap dipakai (atau di-convert ke launchProxy
// untuk Playwright). DataImpulse otomatis dapat sticky session per akun.

const VALID_PROTOCOLS = new Set(["http", "https", "socks4", "socks5"]);

export function parseProxy(line) {
  if (!line) return null;
  const raw = line.trim();
  if (!raw || raw.startsWith("#")) return null;

  // Sudah ada protocol
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const proto = u.protocol.replace(":", "").toLowerCase();
      if (!VALID_PROTOCOLS.has(proto)) return null;
      return raw;
    } catch {
      return null;
    }
  }

  let userPass = "";
  let hostPort = raw;
  if (raw.includes("@")) {
    const [a, b] = raw.split("@");
    userPass = a;
    hostPort = b;
  }

  const parts = hostPort.split(":");
  if (parts.length === 2) {
    const [host, port] = parts;
    if (!host || !port || Number.isNaN(Number(port))) return null;
    return userPass
      ? `http://${userPass}@${host}:${port}`
      : `http://${host}:${port}`;
  }
  if (parts.length === 4 && !userPass) {
    const [host, port, user, pass] = parts;
    if (!host || !port || Number.isNaN(Number(port))) return null;
    return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
  }
  return null;
}

export function parseProxyList(text) {
  if (!text) return [];
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const p = parseProxy(line);
    if (p) out.push(p);
  }
  return out;
}

export function maskProxy(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return url;
  }
}

// Round-robin per akun. Null kalau tanpa proxy.
export function pickProxy(proxies, index) {
  if (!proxies || proxies.length === 0) return null;
  return proxies[index % proxies.length];
}

// Convert URL string → bentuk Playwright launchOptions.proxy.
// Chromium tidak support auth di --proxy-server URL → harus dipisah username/password.
export function toLaunchProxy(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const auth =
      u.username || u.password
        ? {
            username: decodeURIComponent(u.username),
            password: decodeURIComponent(u.password),
          }
        : {};
    const server = `${u.protocol}//${u.host}`;
    return { server, ...auth };
  } catch {
    return null;
  }
}

// DataImpulse sticky session — tiap akun dapet `__sessid.<unique>` unik.
// Ga sentuh proxy lain (cek host pattern dataimpulse.com).
export function withUniqueSession(launchProxy, accountIndex) {
  if (!launchProxy?.server || !launchProxy?.username) return launchProxy;
  if (!/\bdataimpulse\.com\b/i.test(launchProxy.server)) return launchProxy;
  if (/__sessid\./.test(launchProxy.username)) return launchProxy;

  const sessId = `acc${accountIndex}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  return {
    ...launchProxy,
    username: `${launchProxy.username}__sessid.${sessId}`,
  };
}
