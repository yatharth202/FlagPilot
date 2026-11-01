/** Normalize a flag key the same way for database lookups and cache keys. */
export const normalizeFlagKey = (key) => String(key || "").trim().toLowerCase();


export const buildFeatureFlagCacheKey = (projectId, key, environment) => {
  if (!projectId) throw new TypeError("projectId is required for a scoped feature-flag cache key");
  if (!['dev', 'prod'].includes(environment)) throw new TypeError("environment must be dev or prod");
  return `${String(projectId)}:${environment}:${normalizeFlagKey(key)}`;
};
