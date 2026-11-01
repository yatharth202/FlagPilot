import { useContext, useEffect, useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import toast from "react-hot-toast";
import API, { getErrorMessage } from "../api/axios.js";
import { AuthContext } from "../context/auth-context.js";
import GoogleSignInButton from "../components/GoogleSignInButton.jsx";
import { beginGoogleSignIn, googleSignInErrorMessage } from "../utils/googleSignIn.js";

function Register() {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const requestedNext = new URLSearchParams(location.search).get("next");
  const afterRegister = requestedNext === "/invite/accept" ? requestedNext : "/dashboard";
  const { login, projectLoading } = useContext(AuthContext);
  const googleError = new URLSearchParams(location.search).get("google_error");

  useEffect(() => {
    if (!googleError) return;
    toast.error(googleSignInErrorMessage(googleError));
    const params = new URLSearchParams(location.search);
    params.delete("google_error");
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ""}`, { replace: true });
  }, [googleError, location.pathname, location.search, navigate]);

  const handleGoogleRegister = () => beginGoogleSignIn(afterRegister);
  const handleChange = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const response = await API.post("/auth/register", form);
      const { accessToken, user } = response.data.data;
      if (!accessToken || !user) throw new Error("The server returned an incomplete registration response.");
      await login({ accessToken, user });
      toast.success("Your account is ready");
      navigate(afterRegister, { replace: true });
    } catch (error) {
      toast.error(getErrorMessage(error, error.message || "Registration failed"));
    } finally { setSubmitting(false); }
  };

  return (
    <main className="grid min-h-screen bg-[#09090b] text-slate-100 md:grid-cols-2">
      <section className="relative hidden overflow-hidden border-r border-white/[0.07] bg-[#111113] p-10 md:flex md:flex-col md:justify-between lg:p-14">
        <div className="pointer-events-none absolute -left-24 top-1/4 h-80 w-80 rounded-full bg-red-500/[0.035] blur-3xl" />
        <div className="relative flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-xl text-indigo-300 ring-1 ring-indigo-300/20">F</div><div><p className="font-semibold text-white">FlagPilot</p><p className="text-xs text-slate-500">Release engineering</p></div></div>
        <div className="relative max-w-lg"><p className="eyebrow">GET STARTED</p><h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-white lg:text-5xl">Keep releases <span className="text-indigo-300">in your hands.</span></h1><p className="mt-5 max-w-md text-base leading-7 text-slate-400">Create a flag, choose who gets the feature, and change the rollout without shipping another build.</p><div className="mt-8 space-y-3"><div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4"><p className="text-sm font-semibold text-slate-200">Gradual releases</p><p className="mt-1 text-xs leading-5 text-slate-500">Start small, observe results, and expand rollout deliberately.</p></div><div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4"><p className="text-sm font-semibold text-slate-200">Customer targeting</p><p className="mt-1 text-xs leading-5 text-slate-500">Choose audiences with explicit targets and attribute rules.</p></div><div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4"><p className="text-sm font-semibold text-slate-200">Controlled Production changes</p><p className="mt-1 text-xs leading-5 text-slate-500">Stage changes for review and keep an auditable release history.</p></div></div></div>
        <p className="relative text-xs text-slate-600">Start in Development. Promote to Production when you are ready.</p>
      </section>
      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md"><div className="mb-9 flex items-center gap-3 md:hidden"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-xl text-indigo-300">F</div><div><p className="font-semibold text-white">FlagPilot</p><p className="text-xs text-slate-500">Release engineering</p></div></div>
          <p className="eyebrow">Get started</p><h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">Create your account</h2><p className="mt-2 text-sm leading-6 text-slate-400">Create an account to set up your first project.</p>
          <div className="mt-8 space-y-4">
            <GoogleSignInButton onClick={handleGoogleRegister} disabled={projectLoading} label="Sign up with Google" />
            <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-slate-600"><span className="h-px flex-1 bg-white/[0.08]" /><span>or use email</span><span className="h-px flex-1 bg-white/[0.08]" /></div>
          </div>
          <form onSubmit={handleSubmit} className="mt-5 space-y-5">
            <div><label htmlFor="register-name" className="mb-2 block text-sm font-medium text-slate-300">Full name</label><input id="register-name" name="name" autoComplete="name" placeholder="Your name" value={form.name} onChange={handleChange} required maxLength={100} className="input-control !py-3" /></div>
            <div><label htmlFor="register-email" className="mb-2 block text-sm font-medium text-slate-300">Email address</label><input id="register-email" name="email" type="email" autoComplete="email" placeholder="you@company.com" value={form.email} onChange={handleChange} required className="input-control !py-3" /></div>
            <div><label htmlFor="register-password" className="mb-2 block text-sm font-medium text-slate-300">Password</label><input id="register-password" name="password" type="password" autoComplete="new-password" placeholder="At least 8 characters" value={form.password} onChange={handleChange} required minLength={8} className="input-control !py-3" /><p className="mt-2 text-xs text-slate-500">Use at least 8 characters. Your role is assigned by the server.</p></div>
            <button type="submit" disabled={submitting || projectLoading} className="btn-primary w-full !py-3">{projectLoading ? "Restoring session…" : submitting ? "Creating account…" : "Create account"}<span aria-hidden="true">→</span></button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-500">Already have an account? <Link to={afterRegister !== "/dashboard" ? `/login?next=${encodeURIComponent(afterRegister)}` : "/login"} className="font-medium text-indigo-300 hover:text-indigo-200">Sign in</Link></p>
        </div>
      </section>
    </main>
  );
}

export default Register;
