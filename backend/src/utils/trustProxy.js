import { isIP } from "node:net";

const TRUSTED_GROUPS = new Set(["loopback", "linklocal", "uniquelocal"]);

const isValidIpOrCidr = (value) => {
  const [address, prefixText, ...extra] = value.split("/");
  if (extra.length) return false;
  const family = isIP(address);
  if (!family) return false;
  if (prefixText === undefined) return true;
  if (!/^\d+$/.test(prefixText)) return false;
  const prefix = Number(prefixText);
  return prefix >= 0 && prefix <= (family === 4 ? 32 : 128);
};


export const parseTrustProxy = (rawValue, { production = process.env.NODE_ENV === "production" } = {}) => {
  const value = String(rawValue ?? "").trim();
  if (!value || value.toLowerCase() === "false" || value === "0") return false;
  if (value.toLowerCase() === "true") {
    if (production) throw new Error("TRUST_PROXY=true is unsafe in production; configure an exact hop count or trusted proxy address/range");
    return true;
  }
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (!Number.isSafeInteger(hops) || hops < 0 || hops > 10) {
      throw new Error("TRUST_PROXY hop count must be between 0 and 10");
    }
    return hops;
  }

  const entries = value.split(",").map((entry) => entry.trim().toLowerCase());
  if (!entries.length || entries.some((entry) => !entry || (!TRUSTED_GROUPS.has(entry) && !isValidIpOrCidr(entry)))) {
    throw new Error("TRUST_PROXY must be false, a hop count (0-10), a trusted IP/CIDR, or loopback/linklocal/uniquelocal");
  }
  return entries;
};
