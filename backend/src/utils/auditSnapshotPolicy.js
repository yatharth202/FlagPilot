const MAX_SNAPSHOT_BYTES = 16 * 1024;

export const boundAuditSnapshot = (value) => {
  if (value === null || value === undefined) return null;
  const serialized = JSON.stringify(value);
  const byteLength = Buffer.byteLength(serialized || "null");
  if (byteLength <= MAX_SNAPSHOT_BYTES) return value;
  return {
    truncated: true,
    originalBytes: byteLength,
    preview: Buffer.from(serialized, "utf8").subarray(0, MAX_SNAPSHOT_BYTES).toString("utf8"),
  };
};
