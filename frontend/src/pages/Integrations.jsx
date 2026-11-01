import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import Sidebar from "../components/Sidebar.jsx";
import { AuthContext } from "../context/auth-context.js";
import API, { getErrorMessage } from "../api/axios.js";

const panelClass = "rounded-xl border border-white/[0.08] bg-[#111113]";
const buttonClass = "rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-red-400/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-50";
const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
};
const shortSha = (sha) => typeof sha === "string" ? sha.slice(0, 10) : "—";
const stateClass = (state) => ({
  success: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
  failure: "border-red-400/20 bg-red-400/10 text-red-200",
  error: "border-red-400/20 bg-red-400/10 text-red-200",
  in_progress: "border-sky-400/20 bg-sky-400/10 text-sky-200",
  queued: "border-amber-400/20 bg-amber-400/10 text-amber-200",
  pending: "border-amber-400/20 bg-amber-400/10 text-amber-200",
  inactive: "border-zinc-600/30 bg-zinc-600/10 text-zinc-300",
}[state] || "border-zinc-700 bg-zinc-700/10 text-zinc-300");

function Integrations() {
  const { project } = useContext(AuthContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const [overview, setOverview] = useState({ configured: false, installations: [], repositories: [], deployments: [] });
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState("");
  const [repositoryLists, setRepositoryLists] = useState({});
  const [selectedRepositories, setSelectedRepositories] = useState({});
  const [loadingRepositories, setLoadingRepositories] = useState("");
  const [savingRepositories, setSavingRepositories] = useState("");
  const canManage = ["owner", "admin"].includes(project?.role);

  const loadOverview = useCallback(async () => {
    if (!project?.id) return;
    setLoading(true);
    try {
      const response = await API.get("/github/current");
      setOverview(response.data?.data || { configured: false, installations: [], repositories: [], deployments: [] });
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not load GitHub integration status"));
    } finally { setLoading(false); }
  }, [project?.id]);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  useEffect(() => {
    const result = searchParams.get("github");
    if (!result) return;
    if (result === "connected") toast.success("GitHub App connected to this project");
    else toast.error(searchParams.get("reason") === "permission" ? "Your project role no longer permits this connection" : "GitHub could not complete the installation. Start again from FlagPilot.");
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("github");
      next.delete("reason");
      return next;
    }, { replace: true });
    loadOverview();
  }, [searchParams, setSearchParams, loadOverview]);

  const connectGitHub = async () => {
    setConnecting(true);
    try {
      const response = await API.post("/github/current/installations/start", {});
      const url = response.data?.data?.installationUrl;
      if (!url || !url.startsWith("https://github.com/apps/")) throw new Error("FlagPilot returned an invalid GitHub installation URL");
      window.location.assign(url);
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not start GitHub App installation"));
      setConnecting(false);
    }
  };

  const loadRepositories = async (installationId) => {
    const key = String(installationId);
    setLoadingRepositories(key);
    try {
      const response = await API.get(`/github/current/installations/${key}/repositories`);
      const items = Array.isArray(response.data?.data) ? response.data.data : [];
      setRepositoryLists((current) => ({ ...current, [key]: items }));
      setSelectedRepositories((current) => ({ ...current, [key]: items.filter((item) => item.linked).map((item) => item.id) }));
    } catch (error) { toast.error(getErrorMessage(error, "Could not load GitHub repositories")); }
    finally { setLoadingRepositories(""); }
  };

  const saveRepositories = async (installationId) => {
    const key = String(installationId);
    setSavingRepositories(key);
    try {
      const response = await API.put(`/github/current/installations/${key}/repositories`, { repositoryIds: selectedRepositories[key] || [] });
      toast.success(response.data?.message || "Repository selection saved");
      await loadOverview();
      await loadRepositories(installationId);
    } catch (error) { toast.error(getErrorMessage(error, "Could not save repository selection")); }
    finally { setSavingRepositories(""); }
  };

  const disconnect = async (installationId, accountLogin) => {
    if (!window.confirm(`Disconnect ${accountLogin} from this FlagPilot project? Linked repositories will stop receiving deployment events. The GitHub App will remain installed in GitHub.`)) return;
    setDisconnecting(String(installationId));
    try {
      await API.delete(`/github/current/installations/${installationId}`);
      toast.success("GitHub disconnected from this project");
      setRepositoryLists((current) => { const next = { ...current }; delete next[String(installationId)]; return next; });
      await loadOverview();
    } catch (error) { toast.error(getErrorMessage(error, "Could not disconnect GitHub")); }
    finally { setDisconnecting(""); }
  };

  const installations = overview.installations || [];
  const activeInstallations = installations.filter((item) => !item.disconnectedAt);
  const recentDeployments = useMemo(() => overview.deployments || [], [overview.deployments]);

  return (
    <div className="min-h-screen bg-[#09090b] text-slate-100 md:flex">
      <Sidebar />
      <main className="min-w-0 flex-1 px-4 py-7 sm:px-7 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Developer workflow</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">GitHub integration</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Connect a GitHub App installation, select repositories for this project, and receive verified deployment activity.</p>
            </div>
            {canManage && <button type="button" disabled={connecting || !overview.configured} onClick={connectGitHub} className="rounded-lg bg-red-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50">{connecting ? "Opening GitHub…" : "Connect GitHub App"}</button>}
          </header>

          {!overview.configured && <div className={`${panelClass} mb-6 p-5`}><p className="text-sm font-semibold text-amber-200">GitHub App is not configured on this API</p><p className="mt-2 text-sm leading-6 text-slate-400">A platform operator must configure the GitHub App ID and slug, RSA private key, webhook secret, OAuth client ID/secret, and exact HTTPS OAuth callback URL in the backend environment, then set the GitHub App Setup URL and Webhook URL. Existing FlagPilot features continue to work while this optional integration is unconfigured.</p></div>}
          {!canManage && <div className={`${panelClass} mb-6 p-4 text-sm text-slate-400`}>Your project role is <strong className="capitalize text-slate-200">{project?.role || "member"}</strong>. You can view GitHub connections and deployments, but only Owners and Admins can change integrations.</div>}

          <section className="mb-8">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold text-white">Connected GitHub installations</h2><span className="text-xs text-slate-500">{activeInstallations.length} active</span></div>
            {loading ? <div className={`${panelClass} p-6 text-sm text-slate-500`}>Loading GitHub connections…</div> : installations.length === 0 ? <div className={`${panelClass} p-6`}><p className="text-sm font-medium text-slate-200">No GitHub installation connected</p><p className="mt-1 text-sm text-slate-500">Connect a GitHub App installation to select repositories for this FlagPilot project.</p></div> : <div className="space-y-4">
              {installations.map((installation) => {
                const key = String(installation.installationId);
                const repos = repositoryLists[key] || [];
                const selected = selectedRepositories[key] || [];
                const isDisconnected = Boolean(installation.disconnectedAt);
                const isSuspended = Boolean(installation.suspendedAt);
                return <article key={key} className={`${panelClass} p-5`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-white">{installation.accountLogin}</h3><span className="rounded-md border border-white/10 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-400">{installation.accountType}</span><span className={`rounded-md px-2 py-1 text-[10px] font-semibold ${isDisconnected ? "bg-zinc-700/30 text-zinc-400" : isSuspended ? "bg-amber-400/10 text-amber-200" : "bg-emerald-400/10 text-emerald-200"}`}>{isDisconnected ? "Disconnected" : isSuspended ? "Suspended" : "Connected"}</span></div><p className="mt-1 text-xs text-slate-500">Installation ID {installation.installationId} · Connected {formatDate(installation.connectedAt)}</p></div>
                    {canManage && <div className="flex gap-2">{!isDisconnected && <button type="button" disabled={loadingRepositories === key || isSuspended} onClick={() => loadRepositories(installation.installationId)} className={buttonClass}>{loadingRepositories === key ? "Loading…" : "Manage repositories"}</button>}{!isDisconnected && <button type="button" disabled={disconnecting === key} onClick={() => disconnect(installation.installationId, installation.accountLogin)} className={`${buttonClass} border-red-500/30 text-red-200`}>{disconnecting === key ? "Disconnecting…" : "Disconnect"}</button>}</div>}
                  </div>
                  {repos.length > 0 && <div className="mt-5 border-t border-white/[0.07] pt-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-slate-200">Repository access</p><p className="mt-1 text-xs text-slate-500">Select up to 100 repositories whose deployment events should appear in this project.</p></div><button type="button" disabled={savingRepositories === key} onClick={() => saveRepositories(installation.installationId)} className="rounded-lg bg-indigo-500/90 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-400 disabled:opacity-50">{savingRepositories === key ? "Saving…" : `Save ${selected.length} selected`}</button></div><div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-white/[0.07] p-2">{repos.map((repository) => <label key={repository.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-white/[0.035]"><input type="checkbox" checked={selected.includes(repository.id)} disabled={!selected.includes(repository.id) && selected.length >= 100} onChange={(event) => setSelectedRepositories((current) => ({ ...current, [key]: event.target.checked ? [...(current[key] || []), repository.id] : (current[key] || []).filter((id) => id !== repository.id) }))} className="h-4 w-4 accent-red-500"/><span className="min-w-0 flex-1"><span className="block truncate text-sm text-slate-200">{repository.fullName}</span><span className="text-[11px] text-slate-500">{repository.isPrivate ? "Private" : "Public"} · default branch {repository.defaultBranch}</span></span></label>)}</div></div>}
                  {repositoryLists[key] && repos.length === 0 && <p className="mt-4 text-xs text-slate-500">This GitHub installation has no repositories available to the App.</p>}
                </article>;
              })}
            </div>}
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold text-white">Deployment activity</h2><span className="text-xs text-slate-500">Latest 50 recorded statuses</span></div>
            <div className={`${panelClass} overflow-hidden`}>
              {recentDeployments.length === 0 ? <p className="p-6 text-sm text-slate-500">No GitHub deployments recorded yet. Link a repository and configure the GitHub App to subscribe to deployment_status webhooks.</p> : <div className="divide-y divide-white/[0.06]">{recentDeployments.map((deployment) => <div key={deployment.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold text-slate-200">{deployment.repositoryFullName}</p><span className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase ${stateClass(deployment.state)}`}>{deployment.state.replaceAll("_", " ")}</span></div><p className="mt-1 text-xs text-slate-500">{deployment.environment} · {deployment.ref || "unknown ref"} · <code className="text-slate-400">{shortSha(deployment.sha)}</code>{deployment.creatorLogin ? ` · by ${deployment.creatorLogin}` : ""}</p>{deployment.description && <p className="mt-1 truncate text-xs text-slate-500">{deployment.description}</p>}</div><div className="flex items-center gap-3"><span className="text-right text-[11px] text-slate-500">{formatDate(deployment.deployedAt)}</span>{deployment.environmentUrl && <a href={deployment.environmentUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-300 hover:text-indigo-200">Environment ↗</a>}{deployment.logUrl && <a href={deployment.logUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-300 hover:text-indigo-200">Logs ↗</a>}</div></div>)}</div>}
            </div>
          </section>
          <p className="mt-7 border-t border-white/[0.06] pt-4 text-[11px] text-slate-600">FlagPilot · GitHub App integration · Project: {project?.name || "Loading…"}</p>
        </div>
      </main>
    </div>
  );
}

export default Integrations;
