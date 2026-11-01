const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);


export const parseFrontendOrigins = (rawValue, { production = process.env.NODE_ENV === "production" } = {}) => {
  const raw = String(rawValue ?? "").trim();
  const entries = raw ? raw.split(",").map((item) => item.trim()) : (production ? [] : ["http://localhost:5173"]);
  if (!entries.length || entries.some((origin) => !origin)) {
    throw new Error("FRONTEND_ORIGIN must contain one or more explicit browser origins");
  }

  const validated = entries.map((origin) => {
    let parsed;
    try { parsed = new URL(origin); }
    catch { throw new Error(`Invalid FRONTEND_ORIGIN entry: ${origin}`); }
    if (!(["http:", "https:"].includes(parsed.protocol)) || parsed.origin !== origin || parsed.username || parsed.password) {
      throw new Error(`FRONTEND_ORIGIN entry must be an exact origin without path, credentials, query, or fragment: ${origin}`);
    }
    if (production && parsed.protocol !== "https:") {
      throw new Error("Production FRONTEND_ORIGIN entries must use HTTPS");
    }
    if (production && (LOCAL_HOSTS.has(parsed.hostname.toLowerCase()) || parsed.hostname.toLowerCase().endsWith(".localhost"))) {
      throw new Error("Production FRONTEND_ORIGIN must not contain localhost or loopback origins");
    }
    return parsed.origin;
  });

  if (new Set(validated).size !== validated.length) throw new Error("FRONTEND_ORIGIN contains duplicate entries");
  return validated;
};

export const validateRefreshCookieSameSite = (rawValue, { production = process.env.NODE_ENV === "production" } = {}) => {
  const sameSite = String(rawValue || "lax").trim().toLowerCase();
  if (!["lax", "strict", "none"].includes(sameSite)) {
    throw new Error("REFRESH_COOKIE_SAME_SITE must be lax, strict, or none");
  }
  if (sameSite === "none" && !production) {
    throw new Error("SameSite=None requires HTTPS; use lax or strict in development");
  }
  return sameSite;
};


export const validateMetricsToken = (rawValue) => {
  if (!rawValue) return false;
  const token = String(rawValue);
  if (token.length < 32 || token.length > 512 || /\s/.test(token) || /replace-with|change-me|placeholder|example-secret/i.test(token)) {
    throw new Error("METRICS_TOKEN must be a random secret between 32 and 512 characters; otherwise leave it unset to disable /metrics");
  }
  return true;
};
