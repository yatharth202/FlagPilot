import { useEffect, useState } from "react";
import { trackDemoEvent } from "../utils/analytics.js";

function NewCheckout({ user, variant, environment = "dev" }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {

    const userId = user?.id ? String(user.id) : "";
    if (!userId) return;
    const exposureKey = `flagpilot:exposure:${environment}:new_checkout:${userId}:${variant || "rollout"}`;
    try {
      if (sessionStorage.getItem(exposureKey)) return;
      sessionStorage.setItem(exposureKey, "1");
    } catch {  }

    trackDemoEvent({
      userId, flagKey: "new_checkout", variant: variant || "rollout", environment,
      event: "exposure", metadata: { source: "dashboard_demo" },
    }).catch((error) => {
      try { sessionStorage.removeItem(exposureKey); } catch { /* storage may be unavailable */ }
      console.error("Exposure tracking failed:", error.response?.data || error.message);
    });
  }, [environment, user?.id, variant]);

  const handleBuy = async () => {
    setBusy(true);
    setMessage("");
    try {

      await trackDemoEvent({
        userId: user?.id ? String(user.id) : "",
        flagKey: "new_checkout",
        variant: variant || "rollout",
        environment,
        event: "exposure",
      });
      await trackDemoEvent({
        userId: user?.id ? String(user.id) : "",
        flagKey: "new_checkout",
        variant: variant || "rollout",
        environment,
        event: "conversion",
      });
      setMessage("Test conversion recorded.");
    } catch (error) {
      console.error("Conversion tracking failed:", error.response?.data || error.message);
      setMessage("Couldn't record the event. Check the API and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-red-500/50 bg-[#110d0e] p-6 text-center">
      <span className="inline-flex rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-red-300">New experience</span>
      <h2 className="mb-2 mt-3 text-xl font-bold text-red-400">New Checkout</h2>
      <p className="mb-5 text-sm text-slate-300">A faster, cleaner checkout experience.</p>
      <button
        onClick={handleBuy}
        disabled={busy}
        className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Recording…" : "Buy Now →"}
      </button>
      {message && <p role="status" className={`mt-3 text-xs ${message.startsWith("Couldn't") ? "text-red-300" : "text-emerald-300"}`}>{message}</p>}
    </div>
  );
}

export default NewCheckout;
