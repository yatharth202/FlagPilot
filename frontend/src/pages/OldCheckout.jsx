import { useEffect, useState } from "react";
import { trackDemoEvent } from "../utils/analytics.js";

function OldCheckout({ user, variant, environment = "dev" }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const userId = user?.id ? String(user.id) : "";
    if (!userId) return;
    const exposureKey = `flagpilot:exposure:${environment}:new_checkout:${userId}:${variant || "control"}`;
    try {
      if (sessionStorage.getItem(exposureKey)) return;
      sessionStorage.setItem(exposureKey, "1");
    } catch { }

    trackDemoEvent({
      userId, flagKey: "new_checkout", variant: variant || "control", environment,
      event: "exposure", metadata: { source: "dashboard_demo" },
    }).catch((error) => {
      try { sessionStorage.removeItem(exposureKey); } catch {  }
      console.error("Exposure tracking failed:", error.response?.data || error.message);
    });
  }, [environment, user?.id, variant]);

  const handlePurchase = async () => {
    setBusy(true);
    setMessage("");
    try {
   

      await trackDemoEvent({
        userId: user?.id ? String(user.id) : "",
        flagKey: "new_checkout",
        variant: variant || "control",
        environment,
        event: "exposure",
      });
      await trackDemoEvent({
        userId: user?.id ? String(user.id) : "",
        flagKey: "new_checkout",
        variant: variant || "control",
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
    <div className="rounded-xl border border-zinc-700 bg-[#141416] p-6 text-center">
      <span className="inline-flex rounded-full border border-zinc-700 bg-zinc-800 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-300">Current experience</span>
      <h2 className="mb-2 mt-3 text-xl font-bold text-zinc-100">Standard Checkout</h2>
      <p className="mb-5 text-sm text-slate-400">The existing checkout flow remains in place.</p>
      <button
        onClick={handlePurchase}
        disabled={busy}
        className="rounded-lg border border-zinc-600 bg-zinc-800 px-5 py-2.5 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Recording…" : "Buy Now →"}
      </button>
      {message && <p role="status" className={`mt-3 text-xs ${message.startsWith("Couldn't") ? "text-red-300" : "text-emerald-300"}`}>{message}</p>}
    </div>
  );
}

export default OldCheckout;
