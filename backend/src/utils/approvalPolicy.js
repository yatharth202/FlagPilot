
export const getApprovalStalenessViolation = ({
  action,
  baseVersion,
  currentVersion,
  baseUpdatedAt,
  currentUpdatedAt,
} = {}) => {
  if (action === "COPY_TO_ENVIRONMENT") return null;
  if (!Number.isInteger(baseVersion) || !Number.isInteger(currentVersion)) {
    return "This approval has no valid base version. Ask the Developer to submit it again.";
  }
  if (baseVersion !== currentVersion) {
    return "The Production flag changed after this request was submitted. Ask the Developer to submit a fresh request.";
  }
  if (!baseUpdatedAt || !currentUpdatedAt) {
    return "This approval has no valid version timestamp. Ask the Developer to submit it again.";
  }
  const baseTime = new Date(baseUpdatedAt).getTime();
  const currentTime = new Date(currentUpdatedAt).getTime();
  if (!Number.isFinite(baseTime) || !Number.isFinite(currentTime)) {
    return "This approval has invalid version metadata. Ask the Developer to submit it again.";
  }
  if (baseTime !== currentTime) {
    return "The Production flag changed after this request was submitted. Ask the Developer to submit a fresh request.";
  }
  return null;
};
