import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import API, { getErrorMessage } from "../api/axios.js";
import { AuthContext } from "../context/auth-context.js";

export default function InvitationAccept() {
  const location = useLocation();
  const hashToken = useMemo(() => new URLSearchParams(location.hash.slice(1)).get("token") || "", [location.hash]);
  const [token, setToken] = useState(() => hashToken || (typeof window !== "undefined" ? window.sessionStorage.getItem("flagpilot_pending_invitation_token") || "" : ""));
  const navigate = useNavigate();
  const { user, loadProjects, switchProject, logout } = useContext(AuthContext);
  const [invitation, setInvitation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");
  const returnTo = "/invite/accept";

  useEffect(() => {
    if (hashToken) {
      window.sessionStorage.setItem("flagpilot_pending_invitation_token", hashToken);
      setToken(hashToken);
    }
  }, [hashToken]);

  const loadInvitation = useCallback(async () => {
    if (!token) { setError("The invitation link is missing its token."); setLoading(false); return; }
    setLoading(true);
    try {
      const response = await API.post("/invitations/preview", { token });
      setInvitation(response.data?.data || null);
      setError("");
    } catch (requestError) {
      setInvitation(null);
      setError(getErrorMessage(requestError, "This invitation is invalid or expired."));
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { loadInvitation(); }, [loadInvitation]);

  const accept = async () => {
    setAccepting(true);
    try {
      const response = await API.post("/invitations/accept", { token });
      const projectId = response.data?.data?.project?.id;
      await loadProjects();
      if (projectId) await switchProject(projectId);
      window.sessionStorage.removeItem("flagpilot_pending_invitation_token");
      toast.success("Invitation accepted. Your project is ready.");
      navigate("/dashboard", { replace: true });
    } catch (requestError) { toast.error(getErrorMessage(requestError, "Could not accept invitation")); }
    finally { setAccepting(false); }
  };

  const signInUrl = `/login?next=${encodeURIComponent(returnTo)}`;
  const registerUrl = `/register?next=${encodeURIComponent(returnTo)}`;

  return (
    <main className="grid min-h-screen place-items-center bg-[#09090b] px-5 py-10 text-slate-100">
      <section className="surface w-full max-w-lg p-6 sm:p-8">
        <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/15 text-xl text-indigo-300">F</div><div><p className="font-semibold text-white">FlagPilot</p><p className="text-xs text-slate-500">Project invitation</p></div></div>
        {loading ? <p className="mt-8 text-sm text-slate-400">Checking invitation…</p> : error ? <div className="mt-8"><h1 className="text-xl font-semibold">Invitation unavailable</h1><p className="mt-2 text-sm text-rose-200">{error}</p><button type="button" onClick={loadInvitation} className="btn-secondary mt-5">Try again</button></div> : invitation ? <div className="mt-8"><p className="eyebrow">You have been invited</p><h1 className="mt-2 text-2xl font-semibold">Join {invitation.project.name}</h1><p className="mt-3 text-sm leading-6 text-slate-400">{invitation.invitedBy} invited <strong className="text-slate-200">{invitation.email}</strong> to join this project as <strong className="capitalize text-slate-200">{invitation.role}</strong>.</p><p className="mt-4 text-xs text-slate-500">Expires {new Date(invitation.expiresAt).toLocaleString()}</p>
          {!user ? <div className="mt-7 space-y-3"><p className="text-sm text-slate-300">Sign in with the invited email address, or create an account using that address.</p><Link to={signInUrl} className="btn-primary block w-full text-center">Sign in to accept</Link><Link to={registerUrl} className="btn-secondary block w-full text-center">Create an account</Link></div> : user.email?.toLowerCase() !== invitation.email.toLowerCase() ? <div className="mt-7 rounded-lg border border-amber-300/20 bg-amber-300/[0.05] p-4"><p className="text-sm font-medium text-amber-100">Wrong account signed in</p><p className="mt-1 text-xs leading-5 text-slate-400">This invitation was sent to {invitation.email}, but you are signed in as {user.email}. Switch accounts to continue.</p><button type="button" onClick={async () => { await logout(); navigate(signInUrl, { replace: true }); }} className="btn-secondary mt-4">Sign in with another account</button></div> : <button type="button" disabled={accepting} onClick={accept} className="btn-primary mt-7 w-full">{accepting ? "Accepting invitation…" : "Accept invitation"}</button>}
        </div> : null}
        <div className="mt-8 border-t border-white/[0.07] pt-4"><Link to="/" className="text-xs text-slate-500 hover:text-slate-300">Return to FlagPilot</Link></div>
      </section>
    </main>
  );
}
