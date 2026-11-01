import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import Sidebar from "../components/Sidebar.jsx";
import { AuthContext } from "../context/auth-context.js";
import API, { getErrorMessage } from "../api/axios.js";

const API_ORIGIN = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "").replace(/\/api\/v1$/, "");

function CodePanel({ title, code }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Copied to clipboard");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard access was blocked. Select and copy the code instead.");
    }
  };
  return <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0e0e10]"><div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-3"><p className="text-xs font-medium text-slate-300">{title}</p><button type="button" onClick={copy} className="btn-secondary !px-3 !py-1.5 text-xs">{copied ? "Copied" : "Copy"}</button></div><pre className="overflow-x-auto p-4 text-xs leading-6 text-slate-300"><code>{code}</code></pre></section>;
}

function ClientKeyCard({ environment, clientKey, onRotate, canRotate }) {
  const [busy, setBusy] = useState(false);
  const label = environment === "dev" ? "Development" : "Production";
  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(clientKey || ""); toast.success(`${label} client key copied`); }
    catch { toast.error("Clipboard access was blocked; select the key and copy it manually."); }
  };
  const handleRotate = async () => {
    const approved = window.confirm(`Rotate the ${label} client key? Existing integrations using the old key will stop working immediately.`);
    if (!approved) return;
    setBusy(true);
    try { await onRotate(environment); toast.success(`${label} key rotated`); }
    catch (error) { toast.error(getErrorMessage(error, "Could not rotate client key")); }
    finally { setBusy(false); }
  };
  return <div className="surface min-w-0 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-white">{label} client key</p><p className="mt-1 text-xs text-slate-500">Limited to this project and environment.</p></div><span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${environment === "prod" ? "bg-amber-300/10 text-amber-200" : "bg-sky-300/10 text-sky-200"}`}>{environment.toUpperCase()}</span></div><p className="mt-4 break-all rounded-lg border border-white/[0.08] bg-black/20 p-3 font-mono text-xs text-slate-300">{clientKey || "Loading project key…"}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!clientKey} onClick={handleCopy} className="btn-secondary !px-3 !py-2 text-xs">Copy key</button>{canRotate && <button type="button" disabled={busy || !clientKey} onClick={handleRotate} className="btn-secondary !px-3 !py-2 text-xs">{busy ? "Rotating…" : "Rotate key"}</button>}</div></div>;
}

function DeveloperSetup() {
  const { user, project, projectLoading, rotateClientKey } = useContext(AuthContext);
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [invitationSaving, setInvitationSaving] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("developer");
  const [invitations, setInvitations] = useState([]);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [inviteActionId, setInviteActionId] = useState("");
  const [lastInviteLink, setLastInviteLink] = useState("");
  const [approvals, setApprovals] = useState([]);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [reviewingApproval, setReviewingApproval] = useState("");
  const isProjectOwner = Boolean(project?.ownerId && user?.id && String(project.ownerId) === String(user.id));
  const fetchMembers = useCallback(async () => {
    if (!project) return;
    setMembersLoading(true);
    try {
      const response = await API.get("/projects/current/members");
      setMembers(Array.isArray(response.data?.data) ? response.data.data : []);
    } catch (error) { toast.error(getErrorMessage(error, "Couldn't load project members")); }
    finally { setMembersLoading(false); }
  }, [project]);
  useEffect(() => { fetchMembers(); }, [fetchMembers]);
  const canReviewApprovals = project?.role === "owner" || project?.role === "admin";
  const canManageTeam = canReviewApprovals;
  const fetchInvitations = useCallback(async () => {
    if (!canManageTeam) { setInvitations([]); return; }
    setInvitationsLoading(true);
    try {
      const response = await API.get("/projects/current/invitations");
      setInvitations(Array.isArray(response.data?.data) ? response.data.data : []);
    } catch (error) { toast.error(getErrorMessage(error, "Could not load invitations")); }
    finally { setInvitationsLoading(false); }
  }, [canManageTeam, project?.id]);
  useEffect(() => {
    setInvitations([]);
    setLastInviteLink("");
    setInviteEmail("");
  }, [project?.id]);
  useEffect(() => { fetchInvitations(); }, [fetchInvitations]);
  const fetchApprovals = useCallback(async () => {
    if (!canReviewApprovals) return;
    setApprovalsLoading(true);
    try {
      const response = await API.get("/approvals", { params: { status: "pending", limit: 50 } });
      setApprovals(Array.isArray(response.data?.data) ? response.data.data : []);
    } catch (error) { toast.error(getErrorMessage(error, "Couldn't load Production approvals")); }
    finally { setApprovalsLoading(false); }
  }, [canReviewApprovals, project?.id]);
  useEffect(() => { fetchApprovals(); }, [fetchApprovals]);
  const reviewApproval = async (approval, decision) => {
    setReviewingApproval(String(approval._id));
    try {
      await API.post(`/approvals/${approval._id}/${decision}`, {});
      toast.success(decision === "approve" ? "Production change approved" : "Production change rejected");
      await fetchApprovals();
    } catch (error) { toast.error(getErrorMessage(error, "Could not process approval")); }
    finally { setReviewingApproval(""); }
  };
  const createInvitation = async (event) => {
    event.preventDefault();
    setInvitationSaving(true);
    setLastInviteLink("");
    try {
      const response = await API.post("/projects/current/invitations", { email: inviteEmail, role: inviteRole });
      const invitation = response.data?.data || {};
      if (invitation.invitationUrl) setLastInviteLink(invitation.invitationUrl);
      if (invitation.emailDeliveryStatus === "sent") toast.success("Invitation email accepted by the email provider");
      else if (invitation.deliveryWarning) toast.error(invitation.deliveryWarning);
      else toast.success("Invitation created. Copy the development link below and send it to your teammate.");
      setInviteEmail("");
      await fetchInvitations();
    } catch (error) { toast.error(getErrorMessage(error, "Could not create invitation")); }
    finally { setInvitationSaving(false); }
  };
  const resendInvitation = async (invitation) => {
    setInviteActionId(invitation.id);
    setLastInviteLink("");
    try {
      const response = await API.post(`/projects/current/invitations/${invitation.id}/resend`, {});
      const result = response.data?.data || {};
      if (result.invitationUrl) setLastInviteLink(result.invitationUrl);
      if (result.emailDeliveryStatus === "sent") toast.success("Invitation resent");
      else if (result.deliveryWarning) toast.error(result.deliveryWarning);
      else toast.success("New invitation link created. Copy and share it with your teammate.");
      await fetchInvitations();
    } catch (error) { toast.error(getErrorMessage(error, "Could not resend invitation")); }
    finally { setInviteActionId(""); }
  };
  const revokeInvitation = async (invitation) => {
    if (!window.confirm(`Revoke the invitation for ${invitation.email}? Its current link will stop working.`)) return;
    setInviteActionId(invitation.id);
    try {
      await API.delete(`/projects/current/invitations/${invitation.id}`);
      toast.success("Invitation revoked");
      await fetchInvitations();
    } catch (error) { toast.error(getErrorMessage(error, "Could not revoke invitation")); }
    finally { setInviteActionId(""); }
  };
  const removeMember = async (member) => {
    if (!window.confirm(`Remove ${member.email} from this project? Their access to other projects will remain unchanged.`)) return;
    try {
      await API.delete(`/projects/current/members/${member.id}`);
      toast.success("Member removed");
      await fetchMembers();
    } catch (error) { toast.error(getErrorMessage(error, "Couldn't remove member")); }
  };
  const devKey = project?.clientKeys?.dev || "YOUR_DEVELOPMENT_CLIENT_KEY";
//  const prodKey = project?.clientKeys?.prod || "YOUR_PRODUCTION_CLIENT_KEY";
  const setupSnippet = useMemo(() => `import { FlagPilotClient } from "@flagpilot/client";\n\nconst flags = new FlagPilotClient({\n  apiBaseUrl: "${API_ORIGIN}",\n  clientKey: "${devKey}", // public key for Development only\n  environment: "dev",\n  user: {\n    id: currentUser.id, // stable user ID from your own auth system\n    attributes: { plan: currentUser.plan, country: currentUser.country },\n  },\n  onError: (error, context) => {\n    console.error("FlagPilot SDK error", context, error);\n  },\n});\n\nconst decision = await flags.evaluate("new_checkout");\nif (decision.reason !== "SDK_ERROR" && decision.reason !== "FLAG_NOT_FOUND") {\n  // Render the selected experience (new or default/control), then record exposure.\n  await flags.trackEvent({\n    flagKey: "new_checkout",\n    event: "exposure",\n    variant: decision.variant || "control",\n  });\n}`, [devKey]);
  const trackingSnippet = `const decision = await flags.evaluate("new_checkout");

if (decision.reason !== "SDK_ERROR" && decision.reason !== "FLAG_NOT_FOUND") {
  // Render whichever experience is selected (rollout or default/control).
  await flags.trackEvent({
    flagKey: "new_checkout",
    event: "exposure",
    variant: decision.variant || "control",
  });
}

// Call this after the real business action succeeds in either experience.
// order.id must be stable so retrying the same purchase does not count twice.
async function onOrderSucceeded(order) {
  await flags.trackEvent({
    flagKey: "new_checkout",
    event: "conversion",
    eventId: "purchase-" + order.id,
  });
}`;

  const rotate = async (environment) => rotateClientKey(environment);

  return <div className="flex min-h-screen flex-col bg-[#09090b] text-slate-100 md:flex-row"><Sidebar /><main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-9"><div className="mx-auto max-w-[1500px]">
    <header><p className="eyebrow">Project / SDK setup</p><h1 className="page-title mt-2">SDK & API</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Use these keys and examples to connect an app to this project. Each key is limited to its own environment.</p></header>

    {!projectLoading && !project && <div className="surface mt-6 border border-amber-300/20 p-4 text-sm text-amber-100">Your project is not initialized. If you upgraded an existing database, follow the tenant migration steps in the project README and sign in again.</div>}
    <section className="mt-7 grid gap-3 md:grid-cols-3"><div className="surface p-4"><p className="text-xs text-slate-500">Project</p><p className="mt-2 text-sm font-semibold text-white">{project?.name || (projectLoading ? "Loading…" : "Not initialized")}</p><p className="mt-2 text-xs leading-5 text-slate-500">Accounts can own multiple projects and have independent roles in each project.</p></div><div className="surface p-4"><p className="text-xs text-slate-500">API base URL</p><p className="mt-2 break-all font-mono text-sm text-white">{API_ORIGIN}/api/v1</p><p className="mt-2 text-xs leading-5 text-slate-500">For a hosted deployment, use your deployed API origin.</p></div><div className="surface p-4"><p className="text-xs text-slate-500">SDK package</p><p className="mt-2 font-mono text-sm text-white">@flagpilot/client</p><p className="mt-2 text-xs leading-5 text-amber-200">Local package; not published to npm yet.</p></div></section>

    <section className="surface mt-7 p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
        <div><h2 className="text-base font-semibold text-white">Project team</h2><p className="mt-1 max-w-2xl text-sm leading-5 text-slate-400">Invite people by email. Invitees can accept with an existing FlagPilot account or create a new account using the invited email address.</p></div>
        <span className="rounded-md bg-white/[0.05] px-2 py-1 text-xs text-slate-400">{members.length} members</span>
      </div>
      {canManageTeam && <form onSubmit={createInvitation} className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_160px_auto]">
        <div><label className="sr-only" htmlFor="invite-email">Teammate email</label><input id="invite-email" type="email" autoComplete="email" required maxLength={254} value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} className="input-control" placeholder="teammate@company.com" /></div>
        <div><label className="sr-only" htmlFor="invite-role">Invitation role</label><select id="invite-role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value)} className="input-control">{isProjectOwner && <option value="admin">Admin</option>}<option value="developer">Developer</option><option value="viewer">Viewer</option></select></div>
        <button disabled={invitationSaving} className="btn-primary" type="submit">{invitationSaving ? "Creating…" : "Send invitation"}</button>
      </form>}
      {lastInviteLink && <div className="mt-4 rounded-lg border border-indigo-300/20 bg-indigo-400/[0.05] p-3"><p className="text-xs font-semibold text-indigo-100">Development invitation link</p><p className="mt-1 break-all font-mono text-xs text-slate-300">{lastInviteLink}</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" className="btn-secondary !py-1.5 text-xs" onClick={async () => { try { await navigator.clipboard.writeText(lastInviteLink); toast.success("Invitation link copied"); } catch { toast.error("Clipboard blocked; copy the link manually"); } }}>Copy invitation link</button><a href={lastInviteLink} target="_blank" rel="noreferrer" className="btn-secondary !py-1.5 text-xs">Preview link</a></div></div>}
      {canManageTeam && <div className="mt-5"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-slate-200">Invitations</h3><button type="button" className="btn-secondary !py-1.5 text-xs" onClick={fetchInvitations} disabled={invitationsLoading}>{invitationsLoading ? "Refreshing…" : "Refresh"}</button></div>
        <div className="mt-3 divide-y divide-white/[0.06] rounded-lg border border-white/[0.07]">{invitationsLoading ? <p className="p-4 text-sm text-slate-500">Loading invitations…</p> : invitations.length ? invitations.map((invitation) => <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 p-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-200">{invitation.email}</p><p className="mt-1 text-xs text-slate-500"><span className="capitalize">{invitation.role}</span> · {invitation.emailDeliveryStatus?.replaceAll("_", " ") || "delivery unknown"} · expires {new Date(invitation.expiresAt).toLocaleDateString()}</p></div><div className="flex items-center gap-2"><span className={`rounded-md px-2 py-1 text-[10px] font-semibold uppercase ${invitation.status === "pending" ? "bg-amber-300/10 text-amber-200" : invitation.status === "accepted" ? "bg-emerald-300/10 text-emerald-200" : "bg-white/[0.06] text-slate-400"}`}>{invitation.status}</span>{invitation.status === "pending" && (isProjectOwner || invitation.role !== "admin") && <><button type="button" disabled={inviteActionId === invitation.id} onClick={() => resendInvitation(invitation)} className="btn-secondary !px-2 !py-1.5 text-xs">Resend</button><button type="button" disabled={inviteActionId === invitation.id} onClick={() => revokeInvitation(invitation)} className="btn-secondary !px-2 !py-1.5 text-xs">Revoke</button></>}</div></div>) : <p className="p-4 text-sm text-slate-500">No invitations have been sent for this project.</p>}</div>
      </div>}
      <div className="mt-6"><h3 className="text-sm font-semibold text-slate-200">Current members</h3><div className="mt-3 divide-y divide-white/[0.06] rounded-lg border border-white/[0.07]">{membersLoading ? <p className="p-4 text-sm text-slate-500">Loading members…</p> : members.length ? members.map((member) => <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 p-3"><div><p className="text-sm font-medium text-slate-200">{member.name} {member.isOwner && <span className="ml-1 rounded bg-indigo-400/10 px-1.5 py-0.5 text-[11px] text-indigo-200">OWNER</span>}</p><p className="mt-0.5 text-xs text-slate-500">{member.email}</p></div><div className="flex items-center gap-3"><span className="rounded-md bg-white/[0.05] px-2 py-1 text-xs capitalize text-slate-300">{member.role}</span>{(isProjectOwner || (project?.role === "admin" && member.role !== "admin")) && !member.isOwner && <button type="button" onClick={() => removeMember(member)} className="btn-secondary !px-2 !py-1.5 text-xs">Remove</button>}</div></div>) : <p className="p-4 text-sm text-slate-500">No members found.</p>}</div></div>
      {!isProjectOwner && <p className="mt-3 text-xs text-slate-500">Admins can invite Developer/Viewer roles and manage those invitations. Only the Owner can assign or manage Admin invitations.</p>}
    </section>

    {canReviewApprovals && <section className="surface mt-7 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold text-white">Production approval queue</h2><p className="mt-1 text-sm text-slate-400">Review the exact submitted settings snapshot before applying a Production change.</p></div><button type="button" className="btn-secondary !py-2 text-xs" onClick={fetchApprovals} disabled={approvalsLoading}>{approvalsLoading ? "Refreshing…" : "Refresh"}</button></div>
      <div className="mt-4 space-y-3">{approvalsLoading ? <p className="text-sm text-slate-500">Loading requests…</p> : approvals.length ? approvals.map((approval) => <div key={approval._id} className="rounded-xl border border-white/[0.08] bg-[#0e0e10] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-200">{approval.action?.replaceAll("_", " ")}</p><p className="mt-1 text-xs text-slate-500">{approval.flagId?.name || approval.flagId?.key || "Flag unavailable"} · submitted by {approval.requestedBy?.name || approval.requestedBy?.email || "Developer"}</p><p className="mt-2 text-xs text-slate-400">{approval.createdAt ? new Date(approval.createdAt).toLocaleString() : "Submission time unavailable"}</p></div><span className="rounded-md bg-amber-300/10 px-2 py-1 text-[11px] font-semibold text-amber-200">PENDING</span></div><pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-black/30 p-3 text-[11px] text-slate-400">{JSON.stringify(approval.payload || approval.sourceSnapshot || {}, null, 2)}</pre><div className="mt-3 flex flex-wrap justify-end gap-2"><button type="button" disabled={reviewingApproval === String(approval._id)} onClick={() => reviewApproval(approval, "reject")} className="btn-secondary !py-2 text-xs">Reject</button><button type="button" disabled={reviewingApproval === String(approval._id)} onClick={() => reviewApproval(approval, "approve")} className="btn-primary !py-2 text-xs">{reviewingApproval === String(approval._id) ? "Processing…" : "Approve and apply"}</button></div></div>) : <p className="rounded-lg border border-dashed border-white/10 p-4 text-sm text-slate-500">No pending Production requests.</p>}</div>
    </section>}

    <section className="mt-7"><div className="mb-3"><h2 className="text-base font-semibold text-white">Project client keys</h2><p className="mt-1 text-sm text-slate-400">Client keys are designed to be public. They can evaluate flags and send events only in their assigned project/environment; they cannot create flags or change rollouts.</p></div><div className="grid gap-3 xl:grid-cols-2"><ClientKeyCard environment="dev" clientKey={project?.clientKeys?.dev} onRotate={rotate} canRotate={isProjectOwner} /><ClientKeyCard environment="prod" clientKey={project?.clientKeys?.prod} onRotate={rotate} canRotate={isProjectOwner} /></div><p className="mt-3 text-xs leading-5 text-amber-200/80">Rotating a key revokes the old one immediately. Update each application using that environment's key. Never put your MongoDB URI, JWT secrets, or user access token in an SDK configuration. Only the project owner can rotate keys.</p></section>

    <section className="mt-8 grid gap-6 xl:grid-cols-2"><div className="space-y-3"><div><h2 className="text-base font-semibold text-white">1. Pack and install</h2><p className="mt-1 text-sm text-slate-400">From the repository root, generate a package tarball. Copy it to a separate consumer application's folder and install it there.</p></div><CodePanel title="From this repository root" code="cd sdk && npm test && npm pack" /><CodePanel title="In your own application (after copying the tarball)" code="npm install ./flagpilot-client-0.2.0.tgz" /><p className="text-xs leading-5 text-slate-500">The package isn't on npm yet. The local tarball is the correct way to test it.</p></div><div className="space-y-3"><div><h2 className="text-base font-semibold text-white">2. Initialize and evaluate</h2><p className="mt-1 text-sm text-slate-400">The example uses your Development key. Use your Production key and <code>environment: "prod"</code> for a production app.</p></div><CodePanel title="JavaScript" code={setupSnippet} /></div></section>

    <section className="mt-8 grid gap-6 xl:grid-cols-2"><div className="space-y-3"><div><h2 className="text-base font-semibold text-white">3. Track real events</h2><p className="mt-1 text-sm text-slate-400">Evaluating alone does not create analytics. Track exposure when the feature is actually shown and conversion after the business action succeeds.</p></div><CodePanel title="Event tracking" code={trackingSnippet} /></div><div className="surface p-5 sm:p-6"><p className="eyebrow">Before client use</p><h2 className="mt-2 text-base font-semibold text-white">Before using this with a client</h2><div className="mt-4 space-y-3 text-sm text-slate-300"><p>✓ Project-scoped keys for SDK evaluation and event ingestion</p><p>✓ JWT-protected management APIs scoped to the selected project</p><p>✓ Development and Production keys can be rotated independently</p><p>✓ Email invitations with expiring, single-use acceptance links</p><p>◷ Hosting, backups, monitoring, and security review still need deployment-level validation</p></div></div></section>
    <footer className="mt-8 border-t border-white/[0.06] pt-4 text-[11px] text-slate-600">FlagPilot · Project-scoped evaluation · Never ship server secrets to browser code.</footer>
  </div></main></div>;
}
export default DeveloperSetup;
