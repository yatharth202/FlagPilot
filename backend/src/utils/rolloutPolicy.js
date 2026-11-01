const DEFAULT_MAX_STEP = 25;
const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;
const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const getProductionRolloutPolicyConfig = (env = process.env) => {
  const maxStepRaw = env.PROD_ROLLOUT_MAX_STEP;
  const cooldownRaw = env.PROD_ROLLOUT_COOLDOWN_MS;
  const maxStep = maxStepRaw === undefined || maxStepRaw === "" ? DEFAULT_MAX_STEP : Number(maxStepRaw);
  const cooldownMs = cooldownRaw === undefined || cooldownRaw === "" ? DEFAULT_COOLDOWN_MS : Number(cooldownRaw);

  if (!Number.isInteger(maxStep) || maxStep < 1 || maxStep > 100) {
    throw new Error("PROD_ROLLOUT_MAX_STEP must be an integer between 1 and 100");
  }
  if (!Number.isInteger(cooldownMs) || cooldownMs < 0 || cooldownMs > MAX_COOLDOWN_MS) {
    throw new Error("PROD_ROLLOUT_COOLDOWN_MS must be an integer between 0 and 86400000");
  }
  return { maxStep, cooldownMs };
};


export const getProductionRolloutViolation = ({
  current,
  requested,
  lastIncreaseAt = null,
  now = Date.now(),
  maxStep = DEFAULT_MAX_STEP,
  cooldownMs = DEFAULT_COOLDOWN_MS,
} = {}) => {
  const currentValue = Number(current);
  const requestedValue = Number(requested);
  if (!Number.isFinite(currentValue) || currentValue < 0 || currentValue > 100) return "Current rollout percentage is invalid";
  if (!Number.isFinite(requestedValue) || requestedValue < 0 || requestedValue > 100) return "Rollout percentage must be between 0 and 100";

  const increase = requestedValue - currentValue;

  if (increase <= 0) return null;
  if (!Number.isInteger(maxStep) || maxStep < 1 || maxStep > 100) return "Production rollout step policy is misconfigured";
  if (!Number.isInteger(cooldownMs) || cooldownMs < 0 || cooldownMs > MAX_COOLDOWN_MS) return "Production rollout cooldown policy is misconfigured";
  if (!Number.isFinite(now)) return "Production rollout clock is invalid";
  if (increase > maxStep) return `Production rollout can increase by at most ${maxStep} percentage points per change`;

  if (lastIncreaseAt && cooldownMs > 0) {
    const lastIncreaseTime = new Date(lastIncreaseAt).getTime();
    if (!Number.isFinite(lastIncreaseTime) || lastIncreaseTime > now) {
      return "Stored Production rollout timestamp is invalid; contact an administrator";
    }
    const elapsed = now - lastIncreaseTime;
    if (elapsed < cooldownMs) {
      const seconds = Math.ceil((cooldownMs - elapsed) / 1000);
      return `Production rollout increase is cooling down. Try again in ${seconds} seconds.`;
    }
  }
  return null;
};
