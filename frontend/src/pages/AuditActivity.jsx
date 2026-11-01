import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import Sidebar from "../components/Sidebar.jsx";
import API, { getErrorMessage } from "../api/axios.js";

const entityLabels = {
  feature_flag: "Feature flag",
  project: "Project",
  project_member: "Team membership",
  client_key: "Client key",
  approval_request: "Approval request",
  project_invitation: "Project invitation",
};

const titleForAction = (value = "") => value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const formatDate = (value) => { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : "Unknown time"; };

function AuditEntry({ entry }) {
  const actorName = entry.actor?.name || entry.actor?.email || (entry.actor?.type === "system" ? "System" : "Former or unavailable user");
  const entityName = entry.flag?.name || entry.flag?.key || entityLabels[entry.entityType] || "Project entity";
  const hasChanges = entry.before !== null || entry.after !== null;
  return (
    <article className="border-b border-white/[0.06] px-5 py-4 last:border-b-0">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-indigo-400/20 bg-indigo-400/[0.06] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-200">{entityLabels[entry.entityType] || entry.entityType}</span>
            <span className="text-sm font-semibold text-slate-100">{titleForAction(entry.action)}</span>
            <span className="rounded-md bg-white/[0.05] px-2 py-1 text-[10px] uppercase text-slate-400">{entry.actor?.role || "unknown"}</span>
          </div>
          <p className="mt-2 truncate text-sm text-slate-300">{entityName}</p>
          <p className="mt-1 text-xs text-slate-500">by <span className="text-slate-300">{actorName}</span> · {entry.actor?.type || "legacy"} actor</p>
          {entry.requestId && <p className="mt-1 break-all font-mono text-[10px] text-slate-600">Request {entry.requestId}</p>}
        </div>
        <time className="shrink-0 text-xs text-slate-500">{formatDate(entry.createdAt)}</time>
      </div>
      {hasChanges && <details className="mt-3 rounded-lg border border-white/[0.07] bg-black/20">
        <summary className="cursor-pointer px-3 py-2 text-xs text-slate-400 hover:text-slate-200">Inspect before / after snapshot</summary>
        <div className="grid gap-3 border-t border-white/[0.06] p-3 lg:grid-cols-2">
          <div className="min-w-0"><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Before</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/25 p-3 text-[11px] leading-5 text-slate-400">{entry.before === null ? "No previous state" : JSON.stringify(entry.before, null, 2)}</pre></div>
          <div className="min-w-0"><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">After</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/25 p-3 text-[11px] leading-5 text-slate-400">{entry.after === null ? "No snapshot" : JSON.stringify(entry.after, null, 2)}</pre></div>
        </div>
      </details>}
    </article>
  );
}

export default function AuditActivity() {
  const [entityType, setEntityType] = useState("all");
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestSequence = useRef(0);

  const loadPage = useCallback(async ({ cursor = null, append = false } = {}) => {
    const sequence = ++requestSequence.current;
    append ? setLoadingMore(true) : setLoading(true);
    if (!append) { setItems([]); setNextCursor(null); }
    try {
      const response = await API.get("/audit", { params: { limit: 25, entityType, ...(cursor ? { cursor } : {}) } });
      if (sequence !== requestSequence.current) return;
      const data = response.data?.data || {};
      const pageItems = Array.isArray(data.items) ? data.items : [];
      setItems((current) => append ? [...current, ...pageItems] : pageItems);
      setNextCursor(data.nextCursor || null);
    } catch (error) {
      if (sequence === requestSequence.current) toast.error(getErrorMessage(error, "Couldn't load audit activity"));
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [entityType]);

  useEffect(() => { loadPage(); }, [loadPage]);

  return (
    <div className="flex min-h-screen flex-col bg-[#09090b] text-white md:flex-row">
      <Sidebar />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-9 lg:py-9">
        <div className="mx-auto max-w-6xl">
          <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div><p className="eyebrow">Governance / Immutable history</p><h1 className="page-title mt-2">Audit activity</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Project-scoped history of flag changes, approvals, membership changes and client-key rotation. This is separate from client-submitted analytics events.</p></div>
            <div className="flex items-center gap-2"><label htmlFor="audit-entity" className="sr-only">Filter audit activity</label><select id="audit-entity" value={entityType} onChange={(event) => setEntityType(event.target.value)} className="input-control !w-auto min-w-44"><option value="all">All activity</option><option value="feature_flag">Feature flags</option><option value="project">Project changes</option><option value="project_member">Team membership</option><option value="client_key">Client keys</option><option value="approval_request">Approval requests</option><option value="project_invitation">Invitations</option><option value="github_installation">GitHub installations</option><option value="github_repository">GitHub repositories</option><option value="github_deployment">GitHub deployments</option></select><button type="button" onClick={() => loadPage()} disabled={loading} className="btn-secondary" aria-label="Refresh audit activity">↻</button></div>
          </header>
          <div className="mt-7 grid gap-3 sm:grid-cols-3"><div className="surface p-4"><p className="text-xs text-slate-500">Records loaded</p><p className="mt-2 text-2xl font-semibold text-white">{items.length}</p></div><div className="surface p-4"><p className="text-xs text-slate-500">Unique actions loaded</p><p className="mt-2 text-2xl font-semibold text-white">{new Set(items.map((entry) => entry.action)).size}</p></div><div className="surface p-4"><p className="text-xs text-slate-500">Access</p><p className="mt-2 text-sm font-semibold text-emerald-200">Read-only for all project roles</p></div></div>
          <section className="surface mt-5 overflow-hidden"><div className="border-b border-white/[0.07] px-5 py-4"><h2 className="text-sm font-semibold text-white">Project activity</h2><p className="mt-1 text-xs text-slate-500">Newest first · server-paginated · records are append-only.</p></div>
            {loading ? <div className="space-y-3 p-5">{[1, 2, 3].map((value) => <div key={value} className="h-20 animate-pulse rounded-xl bg-white/[0.03]" />)}</div> : items.length ? <div>{items.map((entry) => <AuditEntry key={entry.id} entry={entry} />)}</div> : <div className="px-6 py-16 text-center"><h3 className="text-sm font-semibold text-slate-200">No audit activity yet</h3><p className="mt-2 text-xs leading-5 text-slate-500">Flag changes, approvals and project administration will appear here after they are recorded.</p></div>}
            {nextCursor && <div className="border-t border-white/[0.06] p-4 text-center"><button type="button" className="btn-secondary" disabled={loadingMore} onClick={() => loadPage({ cursor: nextCursor, append: true })}>{loadingMore ? "Loading…" : "Load older activity"}</button></div>}
          </section>
          <footer className="mt-8 border-t border-white/[0.06] pt-4 text-[11px] text-slate-600">FlagPilot · Audit history is generated by the server. Browser-submitted analytics are not audit records.</footer>
        </div>
      </main>
    </div>
  );
}
