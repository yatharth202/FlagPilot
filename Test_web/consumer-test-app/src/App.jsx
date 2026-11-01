import { useCallback, useEffect, useRef, useState } from 'react';
import { FlagPilotClient } from '@flagpilot/client';

const API_BASE_URL = import.meta.env.VITE_FLAGPILOT_API_URL || 'http://localhost:5180/flagpilot-api/api/v1';
const DEV_KEY = (import.meta.env.VITE_FLAGPILOT_DEV_CLIENT_KEY || '').trim();
const PROD_KEY = (import.meta.env.VITE_FLAGPILOT_PROD_CLIENT_KEY || '').trim();
const CLIENT_KEYS = {
  ...(DEV_KEY ? { dev: DEV_KEY } : {}),
  ...(PROD_KEY ? { prod: PROD_KEY } : {}),
};
const FLAG_KEY = (import.meta.env.VITE_FLAGPILOT_TEST_FLAG || 'new_checkout').trim().toLowerCase();
const INITIAL_ENV = import.meta.env.VITE_FLAGPILOT_ENVIRONMENT === 'prod' ? 'prod' : 'dev';
const ENV_LABEL = { dev: 'Development', prod: 'Production' };
const USER_STORAGE_KEY = 'flagpilot_standalone_test_user';
const ALLOWED_VARIANTS = new Set(['control', 'rollout', 'targeted_user', 'targeted_role', 'rule_match', 'A']);

function makeId(prefix = 'evt') {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${id}`;
}

function getStableUserId() {
  try {
    const saved = localStorage.getItem(USER_STORAGE_KEY);
    if (saved) return saved;
    const id = 'acme_test_user_001';
    localStorage.setItem(USER_STORAGE_KEY, id);
    return id;
  } catch {
    return 'acme_test_user_001';
  }
}

function getVariant(decision) {
  return ALLOWED_VARIANTS.has(decision?.variant) ? decision.variant : 'control';
}

function safeErrorMessage(error) {
  const message = error?.message || String(error || 'Unknown error');
  return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}

export default function App() {
  const [activeEnvironment, setActiveEnvironment] = useState(INITIAL_ENV);
  const [userId, setUserId] = useState(getStableUserId);
  const [userIdInput, setUserIdInput] = useState(getStableUserId);
  const [attributesText, setAttributesText] = useState('{\n  "accountType": "customer",\n  "plan": "pro"\n}');
  const [decision, setDecision] = useState(null);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [apiStatus, setApiStatus] = useState('not_checked');
  const [apiMessage, setApiMessage] = useState('Not checked yet');
  const [lastError, setLastError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [eventLog, setEventLog] = useState([]);
  const [purchaseCount, setPurchaseCount] = useState(0);
  const [busy, setBusy] = useState(false);

  const evaluationSequence = useRef(0);
  const exposureKeys = useRef(new Set());
  const orderEventId = useRef(makeId('order'));

  const [sdk] = useState(() => {
    try {
      if (!CLIENT_KEYS[INITIAL_ENV]) {
        throw new Error(`Missing ${ENV_LABEL[INITIAL_ENV]} client key. Set VITE_FLAGPILOT_${INITIAL_ENV.toUpperCase()}_CLIENT_KEY in consumer-test-app/.env.`);
      }
      return {
        client: new FlagPilotClient({
          apiBaseUrl: API_BASE_URL,
          clientKeys: CLIENT_KEYS,
          environment: INITIAL_ENV,
          user: { id: userId, attributes: { accountType: 'customer', plan: 'pro' } },
          timeoutMs: 5000,
          maxRetries: 1,
          onError: (error, context) => {
            console.error('[FlagPilot SDK]', context, error);
            setLastError(safeErrorMessage(error));
          },
        }),
        error: '',
      };
    } catch (error) {
      console.error('[FlagPilot SDK initialization]', error);
      return { client: null, error: safeErrorMessage(error) };
    }
  });
  const client = sdk.client;
  const configuredEnvironments = { dev: Boolean(DEV_KEY), prod: Boolean(PROD_KEY) };
  const decisionReason = decision?.reason || 'Not evaluated';
  const isSdkError = decision?.reason === 'SDK_ERROR';
  const flagMissing = decision?.reason === 'FLAG_NOT_FOUND';
  const featureEnabled = Boolean(decision?.enabled) && !isSdkError && !flagMissing;
  const environmentLabel = ENV_LABEL[activeEnvironment];

  const appendLog = useCallback((kind, detail) => {
    const item = { id: makeId('log'), time: new Date().toLocaleTimeString(), kind, detail };
    setEventLog((items) => [item, ...items].slice(0, 12));
  }, []);

  const checkApi = useCallback(async () => {
    setApiStatus('checking');
    setApiMessage('Checking backend through the local Vite proxy…');
    try {
      const response = await fetch('/flagpilot-api/health', { method: 'GET', headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message || `Health check returned HTTP ${response.status}`);
      setApiStatus('online');
      setApiMessage(`Backend reachable · HTTP ${response.status}`);
      setLastError('');
      appendLog('API', 'Backend health check succeeded through the local proxy.');
    } catch (error) {
      setApiStatus('offline');
      setApiMessage(safeErrorMessage(error));
      setLastError(safeErrorMessage(error));
      appendLog('ERROR', `Backend health check failed: ${safeErrorMessage(error)}`);
    }
  }, [appendLog]);

  const evaluateFlag = useCallback(async () => {
    if (!client) {
      setDecision({ enabled: false, value: false, variant: 'control', reason: 'SDK_ERROR' });
      setLastError((current) => current || sdk.error || 'SDK is not initialized. Check consumer-test-app/.env.');
      return;
    }
    const requestNo = ++evaluationSequence.current;
    setLoading(true);
    setFeedback('');
    try {
      const result = await client.evaluate(FLAG_KEY, { skipCache: true });
      if (requestNo !== evaluationSequence.current) return;
      setDecision(result);
      if (result.reason === 'SDK_ERROR') {
        setLastError((current) => current || sdk.error || 'SDK evaluation failed. Inspect the browser console and backend terminal.');
        appendLog('ERROR', 'Flag evaluation returned SDK_ERROR.');
      } else {
        setLastError('');
        appendLog('EVALUATION', `${FLAG_KEY} → ${result.enabled ? 'enabled' : 'control'} (${result.reason || 'no reason'}) in ${environmentLabel}.`);
      }
    } catch (error) {
      if (requestNo !== evaluationSequence.current) return;
      setDecision({ enabled: false, value: false, variant: 'control', reason: 'SDK_ERROR' });
      setLastError(safeErrorMessage(error));
      appendLog('ERROR', `Evaluation failed: ${safeErrorMessage(error)}`);
    } finally {
      if (requestNo === evaluationSequence.current) setLoading(false);
    }
  }, [appendLog, environmentLabel]);

  useEffect(() => {
    if (sdk.error) setLastError(sdk.error);
    void checkApi();
    void evaluateFlag();
  }, [checkApi, evaluateFlag, sdk.error]);

  useEffect(() => {
    if (!decision || !client || ['SDK_ERROR', 'FLAG_NOT_FOUND'].includes(decision.reason)) return;
    const variant = getVariant(decision);
    const key = `${activeEnvironment}:${FLAG_KEY}:${userId}:${variant}`;
    if (exposureKeys.current.has(key)) return;
    exposureKeys.current.add(key);
    void client.trackEvent({ flagKey: FLAG_KEY, event: 'exposure', variant })
      .then(() => appendLog('EXPOSURE', `${FLAG_KEY} · ${variant} · ${environmentLabel}`))
      .catch((error) => {
        exposureKeys.current.delete(key);
        setLastError(safeErrorMessage(error));
        appendLog('ERROR', `Exposure tracking failed: ${safeErrorMessage(error)}`);
      });
  }, [decision, activeEnvironment, userId, environmentLabel, appendLog]);

  const changeEnvironment = async (nextEnvironment) => {
    if (!['dev', 'prod'].includes(nextEnvironment) || nextEnvironment === activeEnvironment) return;
    if (!CLIENT_KEYS[nextEnvironment]) {
      setFeedback(`Add VITE_FLAGPILOT_${nextEnvironment.toUpperCase()}_CLIENT_KEY to consumer-test-app/.env before switching.`);
      return;
    }
    if (!client) {
      setFeedback('SDK is not initialized. Configure the Development client key first.');
      return;
    }
    setSwitching(true);
    setLoading(true);
    setDecision(null);
    setFeedback('');
    exposureKeys.current.clear();
    evaluationSequence.current += 1;
    try {
      client.setEnvironment(nextEnvironment);
      setActiveEnvironment(nextEnvironment);
      appendLog('ENVIRONMENT', `Switched SDK to ${ENV_LABEL[nextEnvironment]} with its matching client key.`);
      const result = await client.evaluate(FLAG_KEY, { skipCache: true });
      setDecision(result);
      if (result.reason === 'SDK_ERROR') setLastError('Production/Development evaluation failed. Check the key and backend response.');
      else setLastError('');
    } catch (error) {
      setLastError(safeErrorMessage(error));
      setDecision({ enabled: false, value: false, variant: 'control', reason: 'SDK_ERROR' });
    } finally {
      setLoading(false);
      setSwitching(false);
    }
  };

  const applyUserContext = () => {
    if (!client) return setFeedback('SDK is not initialized. Configure the Development key first.');
    const cleanId = userIdInput.trim();
    if (!cleanId) return setFeedback('User ID cannot be empty.');
    try {
      const attributes = JSON.parse(attributesText);
      if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) throw new Error('Attributes must be a JSON object.');
      client.setUser({ id: cleanId, attributes });
      setUserId(cleanId);
      try { localStorage.setItem(USER_STORAGE_KEY, cleanId); } catch { /* Storage can be disabled. */ }
      setDecision(null);
      exposureKeys.current.clear();
      setFeedback('User context updated. Refresh evaluation to test targeting.');
      appendLog('USER', `Evaluation user changed to ${cleanId}.`);
    } catch (error) {
      setFeedback(`Invalid user attributes: ${safeErrorMessage(error)}`);
    }
  };

  const recordConversion = async () => {
    if (!client || !decision || isSdkError || flagMissing || busy) return;
    setBusy(true);
    setFeedback('');
    const variant = getVariant(decision);
    const currentEventId = orderEventId.current;
    try {
      // The backend requires an exposure before a conversion; identical exposure retries are deduplicated.
      await client.trackEvent({ flagKey: FLAG_KEY, event: 'exposure', variant });
      await client.trackEvent({ flagKey: FLAG_KEY, event: 'conversion', variant, eventId: currentEventId });
      setPurchaseCount((count) => count + 1);
      setFeedback('Conversion recorded. This is a test event, not a real payment.');
      appendLog('CONVERSION', `${FLAG_KEY} · ${variant} · event ${currentEventId}`);
      orderEventId.current = makeId('order');
    } catch (error) {
      setLastError(safeErrorMessage(error));
      setFeedback('Conversion failed. The same event ID is retained for a safe retry.');
      appendLog('ERROR', `Conversion failed: ${safeErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const clearLog = () => setEventLog([]);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">A</span><div><strong>ACME STORE</strong><small>Independent customer test app</small></div></div>
        <div className="top-actions">
          <label className="env-control">Environment
            <select value={activeEnvironment} onChange={(event) => void changeEnvironment(event.target.value)} disabled={loading || switching}>
              <option value="dev" disabled={!configuredEnvironments.dev}>Development</option>
              <option value="prod" disabled={!configuredEnvironments.prod}>Production</option>
            </select>
          </label>
          <span className={`pill ${apiStatus === 'online' ? 'good' : apiStatus === 'offline' ? 'bad' : ''}`}>● {apiStatus === 'online' ? 'API online' : apiStatus === 'offline' ? 'API offline' : 'Checking API'}</span>
        </div>
      </header>

      <main className="container">
        <section className="hero">
          <div><div className="eyebrow">CUSTOMER APPLICATION · SDK ACCEPTANCE TEST</div><h1>Test a feature before releasing it.</h1><p>Change a flag in FlagPilot and evaluate the result here using the real JavaScript SDK.</p></div>
          <button className="button primary" onClick={() => void evaluateFlag()} disabled={loading || switching}>{loading ? 'Evaluating…' : '↻ Refresh evaluation'}</button>
        </section>

        <section className="stats">
          <div className="stat"><span>Feature flag</span><strong>{FLAG_KEY}</strong><small>Configured test key</small></div>
          <div className="stat"><span>Decision</span><strong className={featureEnabled ? 'green' : isSdkError || flagMissing ? 'red' : ''}>{loading ? 'Loading…' : isSdkError ? 'Unavailable' : flagMissing ? 'Not found' : featureEnabled ? 'Enabled' : 'Control'}</strong><small>{decisionReason}</small></div>
          <div className="stat"><span>Environment</span><strong>{environmentLabel}</strong><small>Matching environment client key</small></div>
          <div className="stat"><span>Test conversions</span><strong>{purchaseCount}</strong><small>Recorded by the SDK</small></div>
        </section>

        <div className="grid">
          <section className="card main-card">
            <div className="card-heading"><div><div className="eyebrow">CHECKOUT EXPERIMENT</div><h2>{featureEnabled ? 'Express checkout' : 'Standard checkout'}</h2><p>{featureEnabled ? 'This user receives the new checkout experience.' : 'This user receives the default/control experience.'}</p></div><span className={`pill ${isSdkError || flagMissing ? 'bad' : featureEnabled ? 'good' : 'neutral'}`}>{isSdkError ? 'Connection error' : flagMissing ? 'Flag not found' : featureEnabled ? 'New experience' : 'Control experience'}</span></div>
            <div className={`checkout ${featureEnabled ? 'checkout-new' : ''} ${isSdkError || flagMissing ? 'checkout-error' : ''}`}>
              <div className="checkout-icon">{isSdkError || flagMissing ? '!' : featureEnabled ? '✦' : '▣'}</div>
              <div className="eyebrow">{featureEnabled ? 'NEW CHECKOUT EXPERIENCE' : 'DEFAULT EXPERIENCE'}</div>
              <h3>{isSdkError ? 'Cannot reach FlagPilot' : flagMissing ? 'Create this flag first' : featureEnabled ? 'Fewer steps. Faster checkout.' : 'Your existing checkout remains active.'}</h3>
              <p>{isSdkError ? 'The SDK could not evaluate the feature. See the diagnostic panel below.' : flagMissing ? `Create ${FLAG_KEY} in ${environmentLabel} in the FlagPilot dashboard.` : 'This button records a conversion event only. It does not process a payment.'}</p>
              <button className="button primary" onClick={() => void recordConversion()} disabled={busy || loading || isSdkError || flagMissing}>{busy ? 'Recording event…' : 'Record test conversion'}</button>
            </div>
            {feedback && <div className="notice">{feedback}</div>}
          </section>

          <section className="card details-card">
            <div className="eyebrow">EVALUATION DETAILS</div><h2>Why was this experience shown?</h2>
            <div className="detail"><span>Flag</span><code>{FLAG_KEY}</code></div>
            <div className="detail"><span>User ID</span><code>{userId}</code></div>
            <div className="detail"><span>Environment</span><strong>{environmentLabel}</strong></div>
            <div className="detail"><span>Enabled</span><strong>{decision ? String(Boolean(decision.enabled)) : 'Pending'}</strong></div>
            <div className="detail"><span>Reason</span><strong>{decisionReason}</strong></div>
            <div className="detail"><span>Variant</span><strong>{decision?.variant || '—'}</strong></div>
            <button className="button secondary full" onClick={() => void checkApi()}>{apiStatus === 'checking' ? 'Checking…' : 'Check backend health'}</button>
          </section>
        </div>

        <section className="card context-card">
          <div className="eyebrow">TARGETING TEST CONTEXT</div><h2>Change the evaluation user</h2><p>Use different stable test IDs and JSON attributes to exercise user targeting and rules.</p>
          <div className="form-grid"><label>Stable user ID<input value={userIdInput} onChange={(event) => setUserIdInput(event.target.value)} maxLength={200}/></label><label className="attributes-label">User attributes (JSON)<textarea value={attributesText} onChange={(event) => setAttributesText(event.target.value)} rows={4}/></label></div>
          <button className="button secondary" onClick={applyUserContext}>Apply user context</button>
        </section>

        <section className="card diagnostics-card">
          <div className="diagnostic-header"><div><div className="eyebrow">CONNECTION DIAGNOSTICS</div><h2>API and SDK status</h2></div><span className={`pill ${apiStatus === 'online' ? 'good' : apiStatus === 'offline' ? 'bad' : 'neutral'}`}>{apiStatus.toUpperCase()}</span></div>
          <div className="detail"><span>Proxy URL</span><code>/flagpilot-api → localhost:8000</code></div>
          <div className="detail"><span>SDK API URL</span><code>{API_BASE_URL}</code></div>
          <div className="detail"><span>Health check</span><strong>{apiMessage}</strong></div>
          <div className="detail"><span>Development key</span><strong>{DEV_KEY ? `Configured (${DEV_KEY.slice(0, 7)}… )` : 'Missing'}</strong></div>
          <div className="detail"><span>Production key</span><strong>{PROD_KEY ? `Configured (${PROD_KEY.slice(0, 8)}… )` : 'Missing — Production disabled'}</strong></div>
          {lastError && <pre className="error-box">{lastError}</pre>}
          <p className="small-note">The Vite proxy is only for local testing. It avoids browser CORS by forwarding requests server-to-server and removing the Origin header. Production deployments must use HTTPS and an explicit backend CORS allow-list.</p>
        </section>

        <section className="card log-card">
          <div className="diagnostic-header"><div><div className="eyebrow">LOCAL TEST TRACE</div><h2>Recent SDK activity</h2></div><button className="button text-button" onClick={clearLog}>Clear</button></div>
          {eventLog.length === 0 ? <p className="muted">No activity recorded yet.</p> : <div className="log-list">{eventLog.map((entry) => <div className="log-entry" key={entry.id}><time>{entry.time}</time><strong>{entry.kind}</strong><span>{entry.detail}</span></div>)}</div>}
        </section>

        <footer className="footer"><strong>ACME STORE</strong><span>Standalone consumer test app · FlagPilot SDK 0.2.0</span></footer>
      </main>
    </div>
  );
}
