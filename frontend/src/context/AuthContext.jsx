import { useCallback, useEffect, useState } from "react";
import API, { getAccessToken, restoreSession, setAccessToken } from "../api/axios.js";
import { AuthContext } from "./auth-context.js";

const ACTIVE_PROJECT_KEY = "flagpilot_active_project_id";

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [project, setProject] = useState(null);
  const [projects, setProjects] = useState([]);
  const [projectLoading, setProjectLoading] = useState(true);

  const loadProjects = useCallback(async () => {
    if (!getAccessToken()) {
      setProjects([]);
      return [];
    }
    const response = await API.get("/projects");
    const items = Array.isArray(response.data?.data) ? response.data.data : [];
    setProjects(items);
    return items;
  }, []);

  const loadProject = useCallback(async () => {
    if (!getAccessToken()) {
      setProject(null);
      setProjectLoading(false);
      return null;
    }
    setProjectLoading(true);
    try {
      const response = await API.get("/projects/current");
      const next = response.data?.data || null;
      setProject(next);
      if (next?.role) setUser((current) => current ? { ...current, role: next.role, projectId: next.id } : current);
      if (next?.clientKeys?.dev) localStorage.setItem("flagpilot_client_key_dev", next.clientKeys.dev);
      if (next?.clientKeys?.prod) localStorage.setItem("flagpilot_client_key_prod", next.clientKeys.prod);
      return next;
    } finally {
      setProjectLoading(false);
    }
  }, []);

  const chooseInitialProject = useCallback(async (preferredProjectId = null) => {
    const available = await loadProjects();
    const savedId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    const selected = available.find((item) => String(item.id) === String(preferredProjectId || savedId)) || available[0];
    if (!selected) {
      localStorage.removeItem(ACTIVE_PROJECT_KEY);
      throw new Error("This account does not have an accessible project. Create one or ask a project owner for access.");
    }

    localStorage.setItem(ACTIVE_PROJECT_KEY, selected.id);
    await API.post(`/projects/${selected.id}/select`, {});
    await loadProject();
    return selected;
  }, [loadProjects, loadProject]);

  useEffect(() => {
    let active = true;
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");

    const bootstrap = async () => {
      const token = await restoreSession();
      if (!active) return;
      if (!token) {
        setUser(null);
        setProject(null);
        setProjects([]);
        setProjectLoading(false);
        return;
      }
      try {
        const available = await loadProjects();
        if (!active) return;
        const savedId = localStorage.getItem(ACTIVE_PROJECT_KEY);
        const selected = available.find((item) => String(item.id) === String(savedId)) || available[0];
        if (!selected) throw new Error("No accessible projects");
        localStorage.setItem(ACTIVE_PROJECT_KEY, selected.id);
        await API.post(`/projects/${selected.id}/select`, {});
        const me = await API.get("/auth/me");
        if (!active) return;
        setUser(me.data?.user || null);
        await loadProject();
      } catch {
        if (active) {
          setAccessToken(null);
          setUser(null);
          setProject(null);
          setProjects([]);
          localStorage.removeItem(ACTIVE_PROJECT_KEY);
          setProjectLoading(false);
        }
      }
    };

    bootstrap();
    return () => { active = false; };
  }, [loadProjects, loadProject]);

  const login = async (data) => {
    setAccessToken(data.accessToken);
    localStorage.removeItem(ACTIVE_PROJECT_KEY);
    setUser(data.user || null);
    await chooseInitialProject(data.user?.projectId || null);
  };

  const logout = async () => {
    let serverRevoked = false;
    try {
      await API.post("/auth/logout", {});
      serverRevoked = true;
    } catch {

    } finally {
      setAccessToken(null);
      setUser(null);
      setProject(null);
      setProjects([]);
      [ACTIVE_PROJECT_KEY, "flagpilot_client_key_dev", "flagpilot_client_key_prod"].forEach((key) => localStorage.removeItem(key));
    }
    return serverRevoked;
  };

  const switchProject = async (projectId) => {
    let available = projects;
    let target = available.find((item) => String(item.id) === String(projectId));

    if (!target) {
      available = await loadProjects();
      target = available.find((item) => String(item.id) === String(projectId));
    }
    if (!target) throw new Error("You do not have access to that project");
    const previousId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    localStorage.removeItem("flagpilot_client_key_dev");
    localStorage.removeItem("flagpilot_client_key_prod");
    localStorage.setItem(ACTIVE_PROJECT_KEY, target.id);
    setProjectLoading(true);
    try {
      await API.post(`/projects/${target.id}/select`, {});
      await loadProject();
      return target;
    } catch (error) {
      if (previousId) localStorage.setItem(ACTIVE_PROJECT_KEY, previousId);
      else localStorage.removeItem(ACTIVE_PROJECT_KEY);
      await loadProject().catch(() => {});
      throw error;
    }
  };

  const createProject = async (name) => {
    const response = await API.post("/projects", { name });
    const created = response.data?.data;
    if (!created?.id) throw new Error("The server did not return the new project ID");
    const available = await loadProjects();
    const added = available.find((item) => String(item.id) === String(created.id));
    if (!added) throw new Error("The new project was created but is not visible in your project list");
    await switchProject(added.id);
    return added;
  };

  const renameProject = async (name) => {
    const response = await API.patch("/projects/current", { name });
    const updated = response.data?.data;
    setProject((current) => current ? { ...current, name: updated?.name || name } : current);
    setProjects((current) => current.map((item) => item.id === project?.id ? { ...item, name: updated?.name || name } : item));
    return updated;
  };

  const archiveProject = async () => {
    await API.delete("/projects/current");
    const available = await loadProjects();
    setProject(null);
    if (!available.length) {
      localStorage.removeItem(ACTIVE_PROJECT_KEY);
      throw new Error("Project archived, but this account has no other accessible projects");
    }
    localStorage.setItem(ACTIVE_PROJECT_KEY, available[0].id);
    await API.post(`/projects/${available[0].id}/select`, {});
    await loadProject();
    return available[0];
  };

  const rotateClientKey = async (environment) => {
    const response = await API.post("/projects/current/rotate-client-key", { environment });
    const clientKey = response.data?.data?.clientKey;
    if (!clientKey) throw new Error("The server did not return the new client key");
    localStorage.setItem(`flagpilot_client_key_${environment}`, clientKey);
    setProject((current) => current ? { ...current, clientKeys: { ...current.clientKeys, [environment]: clientKey } } : current);
    return clientKey;
  };

  return <AuthContext.Provider value={{
    user, project, projects, projectLoading, login, logout,
    loadProject, loadProjects, switchProject, createProject, renameProject, archiveProject, rotateClientKey,
  }}>{children}</AuthContext.Provider>;
};
