const hostOf = (raw) => {
  try { return new URL(raw).hostname.toLowerCase(); } catch { return ""; }
};
const suffix = (host, domain) => host === domain || host.endsWith(`.${domain}`);

export function serviceForPage(raw) {
  const host = hostOf(raw);
  if (suffix(host, "facebook.com")) return "facebook";
  if (suffix(host, "tiktok.com")) return "tiktok";
  return "";
}

export function serviceForCdn(raw) {
  const host = hostOf(raw);
  if (suffix(host, "fbcdn.net") || suffix(host, "fbsbx.com") || suffix(host, "facebook.com")) return "facebook";
  if (
    suffix(host, "tiktokcdn.com") || suffix(host, "tiktokcdn-us.com") ||
    suffix(host, "tiktokcdn-eu.com") || suffix(host, "tiktokcdn-in.com") ||
    suffix(host, "tiktokv.com") || suffix(host, "byteoversea.com") ||
    suffix(host, "ibytedtos.com") || suffix(host, "ibyteimg.com") ||
    suffix(host, "muscdn.com") || suffix(host, "tiktok.com")
  ) return "tiktok";
  return "";
}
