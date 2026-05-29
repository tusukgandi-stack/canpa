// Format error per akun jadi 1-2 line: kategori + pesan asli (max 100 char).
export function categorizeError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  if (msg.includes("aborted")) return "Dibatalkan";
  if (msg.includes("otp timeout")) return "OTP timeout";
  if (msg.includes("hubify")) return "Hubify error";
  if (msg.includes("canva server error") || msg.includes("canva not ready"))
    return "Canva error";
  if (msg.includes("sign up") || msg.includes("tombol")) return "Canva UI";
  if (msg.includes("leonardo")) return "Leonardo OAuth";
  if (
    msg.includes("net::") ||
    msg.includes("err_") ||
    msg.includes("timeout") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset")
  )
    return "Network";
  if (msg.includes("browser") || msg.includes("playwright"))
    return "Browser stuck";
  return "Error";
}

export function shortError(err) {
  const cat = categorizeError(err);
  const detail = String(err?.message || err || "")
    .replace(/\s+/g, " ")
    .slice(0, 100);
  return `${cat}${detail && detail.toLowerCase() !== cat.toLowerCase() ? `: ${detail}` : ""}`;
}
