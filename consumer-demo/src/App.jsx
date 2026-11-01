import { useCallback, useEffect, useRef, useState } from "react";
import { FlagPilotClient } from "@flagpilot/client";

// Keep this key identical to the flag key in the FlagPilot dashboard.
const FLAG_KEY = "ashu_test_flag";
const USER_ID = "ashu-demo-user-004";
const API_BASE_URL =
  import.meta.env.VITE_FLAGPILOT_API_URL || "http://localhost:8000/api/v1";

// The old single-key variable remains supported for Development.
const DEV_CLIENT_KEY =
  import.meta.env.VITE_FLAGPILOT_DEV_CLIENT_KEY ||
  import.meta.env.VITE_FLAGPILOT_CLIENT_KEY;
const PROD_CLIENT_KEY = import.meta.env.VITE_FLAGPILOT_PROD_CLIENT_KEY;

const CLIENT_KEYS = {
  ...(typeof DEV_CLIENT_KEY === "string" && DEV_CLIENT_KEY.trim()
    ? { dev: DEV_CLIENT_KEY.trim() }
    : {}),
  ...(typeof PROD_CLIENT_KEY === "string" && PROD_CLIENT_KEY.trim()
    ? { prod: PROD_CLIENT_KEY.trim() }
    : {}),
};

const RAW_ENVIRONMENT = String(
  import.meta.env.VITE_FLAGPILOT_ENVIRONMENT || "dev"
)
  .trim()
  .toLowerCase();
const INITIAL_ENVIRONMENT = ["dev", "prod"].includes(RAW_ENVIRONMENT)
  ? RAW_ENVIRONMENT
  : "dev";

const ENVIRONMENT_LABELS = {
  dev: "Development",
  prod: "Production",
};

const ALLOWED_VARIANTS = new Set([
  "control",
  "rollout",
  "targeted_user",
  "targeted_role",
  "rule_match",
  "A",
]);

function createEventId() {
  if (globalThis.crypto?.randomUUID) {
    return `order_${globalThis.crypto.randomUUID()}`;
  }
  return `order_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function getAnalyticsVariant(decision) {
  return ALLOWED_VARIANTS.has(decision?.variant)
    ? decision.variant
    : "control";
}

function readableReason(reason) {
  const reasons = {
    ROLLOUT_MATCH: "Included in rollout",
    ROLLOUT_MISS: "Not selected for rollout",
    ROLLOUT_ZERO: "Rollout is set to 0%",
    FLAG_DISABLED: "Feature flag is turned off",
    TARGETED_USER: "Matched a targeted user",
    TARGETED_ROLE: "Matched a targeted role",
    RULE_MATCH: "Matched a targeting rule",
    ENV_MISMATCH: "Environment mismatch",
    FLAG_NOT_FOUND: "This flag does not exist in this environment",
    SDK_ERROR: "Could not connect to FlagPilot",
  };
  return reasons[reason] || reason || "Evaluation complete";
}

let flagPilot = null;
let sdkInitializationError = null;
let latestSdkError = null;

try {
  if (!CLIENT_KEYS[INITIAL_ENVIRONMENT]) {
    throw new Error(
      `Missing ${ENVIRONMENT_LABELS[INITIAL_ENVIRONMENT]} client key. ` +
        `Set VITE_FLAGPILOT_${INITIAL_ENVIRONMENT.toUpperCase()}_CLIENT_KEY in consumer-demo/.env.`
    );
  }

  flagPilot = new FlagPilotClient({
    apiBaseUrl: API_BASE_URL,
    clientKeys: CLIENT_KEYS,
    environment: INITIAL_ENVIRONMENT,
    user: {
      id: USER_ID,
      attributes: {
        accountType: "customer",
      },
    },
    onError: (error, context) => {
      latestSdkError = error;
      console.error("FlagPilot SDK error:", context, error);
    },
  });
} catch (error) {
  sdkInitializationError = error;
  console.error("FlagPilot SDK initialization failed:", error);
}

export default function App() {
  const [decision, setDecision] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeEnvironment, setActiveEnvironment] = useState(
    INITIAL_ENVIRONMENT
  );
  const [message, setMessage] = useState("");
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [cartCount, setCartCount] = useState(1);

  const exposureTracked = useRef(new Set());
  const evaluationRequestId = useRef(0);
  const orderEventId = useRef(createEventId());

  const checkFlag = useCallback(async () => {
    const requestId = ++evaluationRequestId.current;
    setLoading(true);
    setMessage("");

    if (!flagPilot) {
      setDecision({
        enabled: false,
        value: false,
        reason: "SDK_ERROR",
        variant: "control",
      });
      setMessage(
        sdkInitializationError?.message ||
          "SDK is not initialized. Check the Consumer Demo environment file."
      );
      setLoading(false);
      return;
    }

    latestSdkError = null;
    try {
      const result = await flagPilot.evaluate(FLAG_KEY, { skipCache: true });
      if (requestId === evaluationRequestId.current) {
        setDecision(result);
        if (result?.reason === "SDK_ERROR") {
          setMessage(
            latestSdkError?.message ||
              "Evaluation failed. Check the browser console and backend terminal."
          );
        } else if (result?.reason === "FLAG_NOT_FOUND") {
          setMessage(
            `Create the flag '${FLAG_KEY}' in ${ENVIRONMENT_LABELS[activeEnvironment]} in FlagPilot.`
          );
        }
      }
    } catch (error) {
      console.error("Flag evaluation failed:", error);
      if (requestId === evaluationRequestId.current) {
        setDecision({
          enabled: false,
          value: false,
          reason: "SDK_ERROR",
          variant: "control",
        });
        setMessage(error?.message || "Flag evaluation failed.");
      }
    } finally {
      if (requestId === evaluationRequestId.current) {
        setLoading(false);
      }
    }
  }, [activeEnvironment]);

  useEffect(() => {
    void checkFlag();
  }, [checkFlag]);

  const switchEnvironment = useCallback(
    (nextEnvironment) => {
      if (!Object.prototype.hasOwnProperty.call(ENVIRONMENT_LABELS, nextEnvironment)) {
        return;
      }
      if (nextEnvironment === activeEnvironment) return;
      if (loading || purchaseLoading) return;

      if (!CLIENT_KEYS[nextEnvironment]) {
        setMessage(
          `No ${ENVIRONMENT_LABELS[nextEnvironment]} client key is configured. Add VITE_FLAGPILOT_${nextEnvironment.toUpperCase()}_CLIENT_KEY to consumer-demo/.env, then restart Vite.`
        );
        return;
      }
      if (!flagPilot) {
        setMessage(
          sdkInitializationError?.message ||
            "FlagPilot SDK is not initialized. Check consumer-demo/.env."
        );
        return;
      }

      try {
        // setEnvironment updates both the environment and matching API key.
        flagPilot.setEnvironment(nextEnvironment);
        evaluationRequestId.current += 1;
        exposureTracked.current.clear();
        setDecision(null);
        setMessage("");
        setLoading(true);
        setActiveEnvironment(nextEnvironment);
        // Changing activeEnvironment recreates checkFlag; its effect performs
        // exactly one new evaluation using the selected environment.
      } catch (error) {
        console.error("Environment switch failed:", error);
        setMessage(error?.message || "Could not switch environments.");
      }
    },
    [activeEnvironment, loading, purchaseLoading]
  );

  useEffect(() => {
    if (!flagPilot || !decision) return;
    if (["SDK_ERROR", "FLAG_NOT_FOUND"].includes(decision.reason)) return;

    // Control-group users are exposures too; they belong in the denominator.
    const variant = getAnalyticsVariant(decision);
    const exposureKey = `${activeEnvironment}:${FLAG_KEY}:${variant}`;
    if (exposureTracked.current.has(exposureKey)) return;

    exposureTracked.current.add(exposureKey);
    void flagPilot
      .trackEvent({ flagKey: FLAG_KEY, event: "exposure", variant })
      .catch((error) => {
        exposureTracked.current.delete(exposureKey);
        console.error("Exposure tracking failed:", error);
      });
  }, [decision, activeEnvironment]);

  function addToCart() {
    if (cartCount === 0) orderEventId.current = createEventId();
    setCartCount((count) => Math.min(count + 1, 10));
  }

  async function simulatePurchase() {
    if (!flagPilot || !decision) return;
    if (["SDK_ERROR", "FLAG_NOT_FOUND"].includes(decision.reason)) return;
    if (purchaseLoading || cartCount === 0) return;

    setPurchaseLoading(true);
    setMessage("");
    const variant = getAnalyticsVariant(decision);

    try {
      // Ensure a matching exposure exists before recording the conversion.
      await flagPilot.trackEvent({
        flagKey: FLAG_KEY,
        event: "exposure",
        variant,
      });
      await flagPilot.trackEvent({
        flagKey: FLAG_KEY,
        event: "conversion",
        variant,
        eventId: orderEventId.current,
      });
      setMessage("Purchase conversion recorded successfully.");
      setCartCount(0);
    } catch (error) {
      console.error("Conversion tracking failed:", error);
      setMessage(
        error?.message ||
          "Could not record the conversion. Check the browser console."
      );
    } finally {
      setPurchaseLoading(false);
    }
  }

  const isSdkError = decision?.reason === "SDK_ERROR";
  const flagNotFound = decision?.reason === "FLAG_NOT_FOUND";
  const isError = isSdkError || flagNotFound;
  const isEnabled = Boolean(decision?.enabled) && !isError;
  const environmentLabel = ENVIRONMENT_LABELS[activeEnvironment];

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="FlagPilot demo home">
          <span className="brand-mark">F</span>
          <span className="brand-copy">
            <strong>FlagPilot</strong>
            <small>Feature delivery platform</small>
          </span>
        </a>

        <div className="topbar-right">
          <label className="environment-pill">
            <span className="environment-dot" />
            <span>{environmentLabel}</span>
            <select
              aria-label="Select environment"
              value={activeEnvironment}
              onChange={(event) => void switchEnvironment(event.target.value)}
              disabled={loading || purchaseLoading}
              style={{
                border: 0,
                outline: 0,
                background: "transparent",
                color: "inherit",
                font: "inherit",
                cursor: "pointer",
                padding: 0,
                maxWidth: 125,
              }}
            >
              <option value="dev" disabled={!CLIENT_KEYS.dev}>
                Development
              </option>
              <option value="prod" disabled={!CLIENT_KEYS.prod}>
                Production
              </option>
            </select>
          </label>
          <span className="connection-label">
            <span className="connection-dot" />
            Consumer demo
          </span>
        </div>
      </header>

      <main className="main-content">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">YOUR APPLICATION · LIVE FLAG TEST</span>
            <h1>Feature delivery, under control.</h1>
            <p>
              See how a feature flag controls a real application. Change the flag
              in FlagPilot and refresh this page to evaluate the new configuration.
            </p>
          </div>
          <button
            className="button button-secondary"
            onClick={() => void checkFlag()}
            disabled={loading}
          >
            <span className={loading ? "spin" : ""}>↻</span>
            {loading ? "Checking flag..." : "Refresh evaluation"}
          </button>
        </section>

        <section className="summary-strip">
          <div className="summary-item">
            <span className="summary-icon purple-icon">◈</span>
            <div>
              <span className="summary-label">Feature flag</span>
              <strong>{FLAG_KEY}</strong>
            </div>
          </div>
          <div className="summary-item">
            <span className={`summary-icon ${isEnabled ? "green-icon" : "orange-icon"}`}>
              {isEnabled ? "✓" : "○"}
            </span>
            <div>
              <span className="summary-label">Current decision</span>
              <strong>
                {loading
                  ? "Checking..."
                  : decision
                    ? isError
                      ? "Unavailable"
                      : isEnabled
                        ? "Enabled"
                        : "Disabled"
                    : "Waiting for result"}
              </strong>
            </div>
          </div>
          <div className="summary-item">
            <span className="summary-icon blue-icon">⌘</span>
            <div>
              <span className="summary-label">Environment</span>
              <strong>{environmentLabel}</strong>
            </div>
          </div>
        </section>

        <div className="content-grid">
          <section className="panel checkout-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">CONSUMER APPLICATION</span>
                <h2>My Checkout Application</h2>
                <p>This is a separate app using your FlagPilot SDK.</p>
              </div>
              <span
                className={`status-pill ${
                  loading
                    ? "status-neutral"
                    : isError
                      ? "status-error"
                      : isEnabled
                        ? "status-success"
                        : "status-disabled"
                }`}
              >
                <span className="status-dot" />
                {loading
                  ? "Checking"
                  : isSdkError
                    ? "Connection error"
                    : flagNotFound
                      ? "Flag not found"
                      : isEnabled
                        ? "New experience"
                        : "Default experience"}
              </span>
            </div>

            <div
              className={`checkout-preview ${isEnabled ? "checkout-enabled" : ""} ${
                isError ? "checkout-error" : ""
              }`}
            >
              <div className="store-symbol">
                {isEnabled ? "✦" : isError ? "!" : "▣"}
              </div>
              {!decision || loading ? (
                <>
                  <h3>Checking your experience</h3>
                  <p>Retrieving the current flag configuration...</p>
                </>
              ) : isSdkError ? (
                <>
                  <h3>Unable to connect to FlagPilot</h3>
                  <p>
                    Check the API URL, the selected environment's client key,
                    browser console, and backend terminal.
                  </p>
                  <button
                    className="button button-secondary"
                    onClick={() => void checkFlag()}
                    disabled={loading}
                  >
                    Retry connection
                  </button>
                </>
              ) : flagNotFound ? (
                <>
                  <h3>Feature flag not found</h3>
                  <p>
                    Create <strong>{FLAG_KEY}</strong> in {environmentLabel} in
                    the FlagPilot dashboard, then refresh.
                  </p>
                  <button
                    className="button button-secondary"
                    onClick={() => void checkFlag()}
                    disabled={loading}
                  >
                    Retry evaluation
                  </button>
                </>
              ) : isEnabled ? (
                <>
                  <span className="feature-label">NEW EXPERIENCE</span>
                  <h3>New Checkout</h3>
                  <p>A faster, cleaner checkout experience is enabled for this user.</p>
                  <button
                    className="button button-primary"
                    onClick={() => void simulatePurchase()}
                    disabled={purchaseLoading || cartCount === 0}
                  >
                    {purchaseLoading ? "Recording purchase..." : "Simulate successful purchase"}
                    {!purchaseLoading && <span>→</span>}
                  </button>
                </>
              ) : (
                <>
                  <span className="feature-label muted-label">
                    DEFAULT EXPERIENCE · CONTROL
                  </span>
                  <h3>Old Checkout</h3>
                  <p>
                    The existing checkout remains active for this control-group user.
                    Use the test purchase to compare control and rollout conversions.
                  </p>
                  <button
                    className="button button-secondary"
                    onClick={() => void simulatePurchase()}
                    disabled={purchaseLoading || cartCount === 0}
                  >
                    {purchaseLoading ? "Recording purchase..." : "Simulate successful purchase"}
                    {!purchaseLoading && <span>→</span>}
                  </button>
                </>
              )}
            </div>

            {message && (
              <div
                className={`feedback ${
                  message.toLowerCase().includes("failed") ||
                  message.toLowerCase().includes("missing") ||
                  message.toLowerCase().includes("could not")
                    ? "feedback-error"
                    : ""
                }`}
                role="status"
              >
                <span>i</span>
                {message}
              </div>
            )}

            <div className="panel-footer">
              <span className="footer-indicator" />
              Changes made in FlagPilot are evaluated by the backend.
            </div>
          </section>

          <aside className="panel details-panel">
            <span className="eyebrow">EVALUATION DETAILS</span>
            <h2>Why was this shown?</h2>
            <p className="details-description">
              FlagPilot evaluates the flag for this user and environment.
            </p>
            <div className="detail-row">
              <span>Flag key</span>
              <code>{FLAG_KEY}</code>
            </div>
            <div className="detail-row">
              <span>User ID</span>
              <code>{USER_ID}</code>
            </div>
            <div className="detail-row">
              <span>Environment</span>
              <strong>{environmentLabel}</strong>
            </div>
            <div className="detail-row reason-row">
              <span>Evaluation reason</span>
              <strong className={isEnabled ? "reason-good" : ""}>
                {loading
                  ? "Checking..."
                  : decision
                    ? readableReason(decision.reason)
                    : "Waiting for result"}
              </strong>
            </div>
            <div className="info-box">
              <span className="info-icon">i</span>
              <p>
                This page uses a stable test user. Changes to targeting or rollout
                may affect this user's result.
              </p>
            </div>
            <div className="instructions">
              <h3>Try it yourself</h3>
              <ol>
                <li>Open the FlagPilot dashboard.</li>
                <li>Change the {FLAG_KEY} flag in the selected environment.</li>
                <li>Return here and refresh the evaluation.</li>
              </ol>
            </div>
          </aside>
        </div>

        <footer className="page-footer">
          <span>FlagPilot</span>
          <span>SDK integration test · Local development</span>
        </footer>
      </main>
    </div>
  );
}
