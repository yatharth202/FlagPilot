import { NavLink, useNavigate } from "react-router-dom";
import { useContext, useState } from "react";
import { AuthContext } from "../context/auth-context.js";
import toast from "react-hot-toast";

const navItems = [
  { to: "/dashboard", label: "Feature flags", icon: "◈" },
  { to: "/analytics", label: "Analytics", icon: "▥" },
  { to: "/logs", label: "Event logs", icon: "≋" },
  { to: "/activity", label: "Audit activity", icon: "◷" },
  { to: "/developers", label: "SDK & API", icon: "⌘" },
  { to: "/integrations", label: "Integrations", icon: "↗" },
];

function Sidebar() {
  const { user, project, projects, switchProject, createProject, renameProject, archiveProject, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const [switching, setSwitching] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      const serverRevoked = await logout();
      if (!serverRevoked) toast.error("Signed out locally, but the server could not confirm session revocation. Check your connection and sign out again.");
      navigate("/login", { replace: true });
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <aside className="flex min-h-0 w-full shrink-0 flex-col border-b border-white/[0.08] bg-[#0e0e10] px-4 py-5 md:sticky md:top-0 md:h-screen md:min-h-screen md:w-[250px] md:border-b-0 md:border-r md:border-r-zinc-800 md:px-5 md:py-6">
      <div className="flex items-center gap-3 px-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10 text-xl text-red-400 ring-1 ring-red-500/25">F</div>
        <div>
          <p className="text-sm font-semibold tracking-tight text-white">FlagPilot</p>
          <p className="mt-0.5 text-xs text-slate-500">Release controls</p>
        </div>
      </div>

      <div className="mt-7 rounded-lg border border-zinc-800 bg-[#141416] p-3">
        <p className="eyebrow px-1">Project</p>
        <div className="mt-2">
          <label htmlFor="active-project" className="sr-only">Active project</label>
          <select
            id="active-project"
            value={project?.id || ""}
            disabled={switching || !projects?.length}
            onChange={async (event) => {
              if (!event.target.value || event.target.value === project?.id) return;
              setSwitching(true);
              try { await switchProject(event.target.value); }
              catch (error) { window.alert(error?.response?.data?.message || error.message || "Could not switch project"); }
              finally { setSwitching(false); }
            }}
            className="mt-1 w-full rounded-md border border-zinc-700 bg-[#09090b] px-2.5 py-2 text-sm text-slate-100 outline-none focus:border-red-400"
          >
            {(projects || []).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.role}</option>)}
          </select>
          <button type="button" onClick={async () => {
            const name = window.prompt("Name your new FlagPilot project:");
            if (name === null) return;
            setSwitching(true);
            try { await createProject(name); }
            catch (error) { window.alert(error?.response?.data?.message || error.message || "Could not create project"); }
            finally { setSwitching(false); }
          }} disabled={switching} className="mt-2 w-full rounded-md border border-dashed border-zinc-700 px-2.5 py-2 text-left text-xs text-slate-400 transition hover:border-red-400/40 hover:text-red-200 disabled:opacity-50">
            + Create new project
          </button>
          {project?.role === "owner" && <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" disabled={switching} onClick={async () => {
              const name = window.prompt("Rename this project:", project.name);
              if (name === null || !name.trim() || name.trim() === project.name) return;
              setSwitching(true);
              try { await renameProject(name.trim()); }
              catch (error) { window.alert(error?.response?.data?.message || error.message || "Could not rename project"); }
              finally { setSwitching(false); }
            }} className="rounded-md border border-zinc-700 px-2 py-2 text-xs text-slate-400 hover:text-slate-100 disabled:opacity-50">Rename</button>
            <button type="button" disabled={switching} onClick={async () => {
              const confirmed = window.confirm(`Archive ${project.name}? It will disappear from active projects, but its data and audit history will be retained. You need another active project to continue.`);
              if (!confirmed) return;
              setSwitching(true);
              try { await archiveProject(); }
              catch (error) { window.alert(error?.response?.data?.message || error.message || "Could not archive project"); }
              finally { setSwitching(false); }
            }} className="rounded-md border border-red-500/25 px-2 py-2 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50">Archive</button>
          </div>}
        </div>
      </div>

      <nav className="mt-7 flex flex-col gap-1" aria-label="Main navigation">
        <p className="eyebrow mb-2 px-3">Manage</p>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                isActive
                  ? "border border-red-500/25 bg-red-500/10 font-semibold text-red-200"
                  : "border border-transparent text-slate-400 hover:border-zinc-800 hover:bg-white/[0.035] hover:text-slate-100"
              }`
            }
          >
            <span className="w-5 text-center text-base" aria-hidden="true">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-7 rounded-lg border border-zinc-800 bg-[#141416] p-3.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <span className="h-2 w-2 rounded-full bg-red-500" />
          Release workflow
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-400">
          Test changes in Development first. Use approvals for Production changes and audit activity for server-recorded history.
        </p>
      </div>

      <div className="mt-auto pt-6">
        <div className="flex items-center gap-3 rounded-lg border border-transparent px-2 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-sm font-semibold text-zinc-100">
            {(user?.name || user?.email || "U").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-200">{user?.name || user?.email || "Signed-in user"}</p>
            <p className="text-xs capitalize text-slate-500">{project?.role || "member"}</p>
          </div>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="ml-1 inline-flex shrink-0 items-center gap-2 rounded-lg border border-red-500/25 px-3 py-2 text-xs font-semibold text-red-200 transition hover:border-red-400/50 hover:bg-red-500/10 focus:outline-none focus:ring-2 focus:ring-red-400/50 disabled:cursor-wait disabled:opacity-50"
            aria-label="Log out of FlagPilot"
            disabled={loggingOut}
          >
            <span aria-hidden="true">↪</span>
            <span>{loggingOut ? "Logging out…" : "Log out"}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
