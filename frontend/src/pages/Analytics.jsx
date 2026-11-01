import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import Sidebar from "../components/Sidebar.jsx";
import API, { getErrorMessage } from "../api/axios.js";

const displayVariant = (value) => ({
  control: "Default experience",
  A: "Gradual rollout",
  rollout: "Gradual rollout",
  targeted_user: "Targeted user",
  targeted_role: "Role match",
  rule_match: "Attribute rule",
}[value] || String(value || "Unknown"));

function Analytics() {
  const [flags, setFlags] = useState([]);
  const [environment, setEnvironment] = useState("dev");
  const [selectedKey, setSelectedKey] = useState("");
  const [analytics, setAnalytics] = useState([]);
  const [loadingFlags, setLoadingFlags] = useState(true);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchFlags = useCallback(async () => {
    setLoadingFlags(true);
    try {
      const response = await API.get("/feature-flags", { params: { environment } });
      const data = Array.isArray(response.data?.data) ? response.data.data : [];
      setFlags(data);
      setSelectedKey((current) => data.some((flag) => flag.key === current) ? current : (data[0]?.key || ""));
    } catch (error) { toast.error(getErrorMessage(error, "Couldn't load flags")); }
    finally { setLoadingFlags(false); }
  }, [environment]);

  const fetchAnalytics = useCallback(async () => {
    if (!selectedKey) { setAnalytics([]); return; }
    setLoadingAnalytics(true);
    try {
      const response = await API.get("/analytics", { params: { key: selectedKey, environment } });
      setAnalytics(Array.isArray(response.data?.data) ? response.data.data : []);
      setLastUpdated(new Date());
    } catch (error) { toast.error(getErrorMessage(error, "Couldn't load analytics")); }
    finally { setLoadingAnalytics(false); }
  }, [selectedKey, environment]);

  useEffect(() => { fetchFlags(); }, [fetchFlags]);
  useEffect(() => {
    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, 15_000);
    return () => clearInterval(interval);
  }, [fetchAnalytics]);

  const processedAnalytics = useMemo(() => {
    const values = new Map();
    for (const item of analytics) {
      const rawVariant = item?._id?.variant || "control";
      const variant = displayVariant(rawVariant);
      const event = item?._id?.event;
      if (!values.has(variant)) values.set(variant, { variant, exposure: 0, conversion: 0, exposedUsers: 0, convertingUsers: 0 });
      if (event === "exposure") {
        values.get(variant).exposure += Number(item.count) || 0;
        values.get(variant).exposedUsers += Number(item.uniqueUsers ?? item.count) || 0;
      }
      if (event === "conversion") {
        values.get(variant).conversion += Number(item.count) || 0;
        values.get(variant).convertingUsers += Number(item.uniqueUsers ?? item.count) || 0;
      }
    }
    return [...values.values()].map((item) => ({ ...item, rate: item.exposedUsers ? Number(((item.convertingUsers / item.exposedUsers) * 100).toFixed(2)) : 0 }));
  }, [analytics]);
  const totals = useMemo(() => processedAnalytics.reduce((acc, item) => ({
    exposure: acc.exposure + item.exposure,
    conversion: acc.conversion + item.conversion,
    exposedUsers: acc.exposedUsers + item.exposedUsers,
    convertingUsers: acc.convertingUsers + item.convertingUsers,
  }), { exposure: 0, conversion: 0, exposedUsers: 0, convertingUsers: 0 }), [processedAnalytics]);
  const conversionRate = totals.exposedUsers ? ((totals.convertingUsers / totals.exposedUsers) * 100).toFixed(2) : "0.00";

  return (
    <div className="flex min-h-screen flex-col bg-[#09090b] text-slate-100 md:flex-row"><Sidebar /><main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-9"><div className="mx-auto max-w-[1500px]">
      <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="eyebrow">Events / Analytics</p><h1 className="page-title mt-2">Analytics</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">See which variants were shown and how often users completed the tracked action. Counts come from events sent by your application.</p></div><div className="flex flex-wrap gap-2"><label className="sr-only" htmlFor="analytics-environment">Environment</label><select id="analytics-environment" value={environment} onChange={(event) => setEnvironment(event.target.value)} className="input-control !w-auto min-w-36"><option value="dev">Development</option><option value="prod">Production</option></select><label className="sr-only" htmlFor="analytics-flag">Feature flag</label><select id="analytics-flag" value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)} className="input-control !w-auto min-w-44 font-mono text-xs" disabled={loadingFlags || !flags.length}><option value="">Select a flag</option>{flags.map((flag) => <option key={flag._id} value={flag.key}>{flag.key}</option>)}</select><button type="button" onClick={fetchAnalytics} disabled={loadingAnalytics || !selectedKey} className="btn-secondary" aria-label="Refresh analytics">↻</button></div></header>
      {!loadingFlags && !flags.length && <div className="surface mt-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium text-slate-200">No flags in {environment === "dev" ? "Development" : "Production"}</p><p className="mt-1 text-xs leading-5 text-slate-500">The flag dropdown is disabled because this environment has no flags yet. Create a flag or copy one from the other environment.</p></div><Link to="/dashboard" className="btn-secondary self-start">Open Feature Flags</Link></div>}

      <section className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3"><div className="surface p-5"><p className="text-xs text-slate-500">Exposed users</p><p className="mt-3 text-3xl font-semibold text-white">{totals.exposedUsers.toLocaleString()}</p><p className="mt-1 text-xs text-slate-600">Unique users with a recorded exposure</p></div><div className="surface p-5"><p className="text-xs text-slate-500">Conversion events</p><p className="mt-3 text-3xl font-semibold text-white">{totals.conversion.toLocaleString()}</p><p className="mt-1 text-xs text-slate-600">Recorded conversions</p></div><div className="surface p-5"><p className="text-xs text-slate-500">Unique-user conversion</p><p className="mt-3 text-3xl font-semibold text-emerald-200">{conversionRate}%</p><p className="mt-1 text-xs text-slate-600">{totals.convertingUsers.toLocaleString()} of {totals.exposedUsers.toLocaleString()} exposed users</p></div></section>

      <section className="surface mt-5 p-5 sm:p-6"><div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center"><div><h2 className="text-base font-semibold text-white">Events by variant</h2><p className="mt-1 text-xs text-slate-500">Compares event counts for the selected feature flag.</p></div><p className="text-xs text-slate-600">{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Not yet refreshed"}</p></div>
        <div className="mt-5 h-[320px] w-full">{loadingFlags || loadingAnalytics ? <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading analytics…</div> : !selectedKey ? <div className="flex h-full flex-col items-center justify-center text-center"><p className="text-sm font-medium text-slate-300">No feature flags found</p><p className="mt-1 text-xs text-slate-500">There are no flags in {environment === "dev" ? "Development" : "Production"}. Switch environments or create a copy from the Feature Flags page.</p></div> : processedAnalytics.length === 0 ? <div className="flex h-full flex-col items-center justify-center text-center"><p className="text-sm font-medium text-slate-300">No analytics events yet</p><p className="mt-1 max-w-md text-xs leading-5 text-slate-500">Connect your application with the FlagPilot SDK. Track an exposure when the feature is shown and a conversion only after the relevant business action succeeds. The SDK tracking calls create these events.</p></div> : <ResponsiveContainer width="100%" height="100%"><BarChart data={processedAnalytics} margin={{ top: 8, right: 12, left: -15, bottom: 0 }}><CartesianGrid stroke="rgba(161,161,170,.16)" vertical={false} /><XAxis dataKey="variant" stroke="#a1a1aa" tickLine={false} axisLine={false} /><YAxis stroke="#a1a1aa" tickLine={false} axisLine={false} allowDecimals={false} /><Tooltip contentStyle={{ background: "#141416", border: "1px solid #35353a", borderRadius: 12, color: "#e2e8f0" }} /><Legend /><Bar dataKey="exposure" name="Exposure" fill="#ef4444" radius={[5, 5, 0, 0]} /><Bar dataKey="conversion" name="Conversion" fill="#4ade80" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer>}</div>
      </section>

      <section className="surface mt-5 p-5 sm:p-6"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold text-white">Variant summary</h2><p className="mt-1 text-xs text-slate-500">Counts are grouped by the variant returned during evaluation.</p></div><span className="rounded-md border border-white/[0.08] px-2 py-1 text-[11px] uppercase tracking-wider text-slate-500">{processedAnalytics.length} groups</span></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead className="border-b border-white/[0.07] text-xs text-slate-500"><tr><th className="py-3 pr-4 font-medium">Variant</th><th className="py-3 pr-4 font-medium">Exposure</th><th className="py-3 pr-4 font-medium">Conversion</th><th className="py-3 pr-4 font-medium">Unique-user conversion</th></tr></thead><tbody className="divide-y divide-white/[0.05]">{processedAnalytics.map((item) => <tr key={item.variant}><td className="py-3 pr-4 font-mono text-red-200">{item.variant}</td><td className="py-3 pr-4 text-slate-300">{item.exposure.toLocaleString()}</td><td className="py-3 pr-4 text-slate-300">{item.conversion.toLocaleString()}</td><td className="py-3 pr-4 text-slate-300">{item.rate.toFixed(2)}% <span className="text-xs text-slate-600">({item.convertingUsers.toLocaleString()} / {item.exposedUsers.toLocaleString()})</span></td></tr>)}</tbody></table>{!processedAnalytics.length && <p className="py-6 text-center text-sm text-slate-600">No data to display.</p>}</div></section>
      <footer className="mt-8 border-t border-white/[0.06] pt-4 text-[11px] text-slate-600">FlagPilot · Analytics are based on events received by this API, not inferred metrics.</footer>
    </div></main></div>
  );
}

export default Analytics;
