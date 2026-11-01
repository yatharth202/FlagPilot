import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import Sidebar from "../components/Sidebar.jsx";
import API, { getErrorMessage } from "../api/axios.js";

function Logs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [environment, setEnvironment] = useState("dev");

  const fetchLogs = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    try {
      const response = await API.get("/analytics/logs", { params: { environment } });
      setLogs(Array.isArray(response.data?.data) ? response.data.data : []);
    } catch (error) {
      if (!quiet) toast.error(getErrorMessage(error, "Couldn't load event logs"));
    } finally { setLoading(false); setRefreshing(false); }
  }, [environment]);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(() => fetchLogs(true), 15_000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  const eventColor = (event) => event === "conversion" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200" : "border-sky-300/20 bg-sky-300/10 text-sky-200";

  return (
    <div className="flex min-h-screen flex-col bg-[#09090b] text-slate-100 md:flex-row"><Sidebar /><main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-9"><div className="mx-auto max-w-[1500px]">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow">Events / Recent activity</p><h1 className="page-title mt-2">Event logs</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Accepted feature exposures and conversion events for the selected environment. Duplicate deliveries are suppressed; distinct conversion events remain visible.</p></div><div className="flex flex-wrap items-center gap-2 self-start"><label className="sr-only" htmlFor="logs-environment">Environment</label><select id="logs-environment" value={environment} onChange={(event) => setEnvironment(event.target.value)} className="input-control !w-auto min-w-36"><option value="dev">Development</option><option value="prod">Production</option></select><button type="button" onClick={() => fetchLogs()} disabled={loading || refreshing} className="btn-secondary">{refreshing ? "Refreshing…" : "↻ Refresh logs"}</button></div></header>
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="surface p-4"><p className="text-xs text-slate-500">Events shown</p><p className="mt-2 text-2xl font-semibold text-white">{logs.length}</p></div><div className="surface p-4"><p className="text-xs text-slate-500">Conversions</p><p className="mt-2 text-2xl font-semibold text-emerald-200">{logs.filter((log) => log.event === "conversion").length}</p></div><div className="surface col-span-2 p-4 sm:col-span-1"><p className="text-xs text-slate-500">Auto-refresh</p><p className="mt-2 text-2xl font-semibold text-white">Every 15 sec</p></div></div>
      <section className="surface mt-5 overflow-hidden"><div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4"><div><h2 className="text-sm font-semibold text-white">Recent activity</h2><p className="mt-1 text-xs text-slate-500">Showing up to 50 events, newest first.</p></div><span className="rounded-md border border-white/[0.08] px-2 py-1 text-[11px] text-slate-500">Auto-refresh on</span></div>
        {loading ? <div className="space-y-3 p-5">{[1, 2, 3, 4].map((item) => <div key={item} className="h-14 animate-pulse rounded-xl bg-white/[0.03]" />)}</div> : logs.length ? <div className="divide-y divide-white/[0.05]">{logs.map((log) => <article key={log._id} className="flex flex-col gap-3 px-5 py-4 transition hover:bg-white/[0.02] sm:flex-row sm:items-center"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] text-lg text-slate-400">{log.event === "conversion" ? "↗" : "◌"}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="break-all font-mono text-sm text-indigo-200">{log.flagKey}</span><span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${eventColor(log.event)}`}>{log.event === "conversion" ? "Conversion" : "Feature exposure"}</span><span className="rounded-md border border-white/[0.07] px-2 py-0.5 text-[11px] text-slate-400">{({ control: "Default experience", A: "Gradual rollout", rollout: "Gradual rollout", targeted_user: "Targeted user", targeted_role: "Role match", rule_match: "Attribute rule" }[log.variant] || log.variant || "Default experience")}</span></div><p className="mt-1.5 truncate text-xs text-slate-500">User ID: <span className="font-mono text-slate-400">{log.userId || "unknown"}</span></p></div><time className="shrink-0 text-xs text-slate-500">{log.createdAt ? new Date(log.createdAt).toLocaleString() : "Unknown time"}</time></article>)}</div> : <div className="px-6 py-16 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-400/10 text-xl text-indigo-300">≋</div><h3 className="mt-4 text-sm font-semibold text-slate-200">No events yet</h3><p className="mx-auto mt-2 max-w-md text-xs leading-5 text-slate-500">Run an application connected to the FlagPilot SDK. Record an exposure when a user is assigned the feature, and record a conversion only after the relevant action succeeds. Refresh after events if needed.</p></div>}
      </section>
      <footer className="mt-8 border-t border-white/[0.06] pt-4 text-[11px] text-slate-600">FlagPilot · Logs are scoped to this project and selected environment. Client-submitted event counts can be spoofed and are not tamper-proof audit evidence.</footer>
    </div></main></div>
  );
}

export default Logs;
