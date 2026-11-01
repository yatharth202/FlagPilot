import { useContext, useEffect, useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import toast from "react-hot-toast";
import API, { getErrorMessage } from "../api/axios.js";
import { AuthContext } from "../context/auth-context.js";
import GoogleSignInButton from "../components/GoogleSignInButton.jsx";
import { beginGoogleSignIn, googleSignInErrorMessage } from "../utils/googleSignIn.js";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const requestedNext = new URLSearchParams(location.search).get("next");
  const afterLogin = requestedNext === "/invite/accept" ? requestedNext : "/dashboard";
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

  const handleGoogleLogin = () => beginGoogleSignIn(afterLogin);

  const handleLogin = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const response = await API.post("/auth/login", { email, password });
      const { accessToken, user } = response.data.data;
      if (!accessToken || !user) throw new Error("The server returned an incomplete login response.");
      await login({ accessToken, user });
      toast.success("Welcome back");
      navigate(afterLogin, { replace: true });
    } catch (error) {
      toast.error(getErrorMessage(error, error.message || "Login failed"));
    } finally { setSubmitting(false); }
  };

  return (
    <main className="grid min-h-screen bg-[#09090b] text-slate-100 md:grid-cols-2">
      <section className="relative hidden overflow-hidden border-r border-white/[0.07] bg-[#111113] p-10 md:flex md:flex-col md:justify-between lg:p-14">
        <div className="pointer-events-none absolute -left-24 top-1/4 h-80 w-80 rounded-full bg-red-500/[0.035] blur-3xl" />
        <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-red-500/[0.025] blur-3xl" />
        <div className="relative flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-xl text-indigo-300 ring-1 ring-indigo-300/20">F</div><div><p className="font-semibold text-white">FlagPilot</p><p className="text-xs text-slate-500">Release engineering</p></div></div>
        <div className="relative max-w-lg"><span className="inline-flex rounded-full border border-indigo-300/20 bg-indigo-400/[0.06] px-3 py-1.5 text-xs font-medium text-indigo-200">FEATURE RELEASES</span><h1 className="mt-6 text-4xl font-semibold leading-tight tracking-tight text-white lg:text-5xl">Ship changes on <span className="text-indigo-300">your schedule.</span></h1><p className="mt-5 max-w-md text-base leading-7 text-slate-400">Turn features on for a small group, check the results, and expand the rollout when you are ready.</p><div className="mt-10 grid max-w-md grid-cols-3 gap-3">{[{ value: "01", label: "Create a flag" }, { value: "02", label: "Roll out slowly" }, { value: "03", label: "Measure impact" }].map((item) => <div key={item.value} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3"><p className="font-mono text-sm text-indigo-300">{item.value}</p><p className="mt-2 text-xs text-slate-400">{item.label}</p></div>)}</div></div>
        <p className="relative text-xs text-slate-600">Feature releases without the redeploy.</p>
      </section>
      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-9 flex items-center gap-3 md:hidden"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-xl text-indigo-300">F</div><div><p className="font-semibold text-white">FlagPilot</p><p className="text-xs text-slate-500">Release engineering</p></div></div>
          <p className="eyebrow">Your workspace</p><h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">Sign in</h2><p className="mt-2 text-sm leading-6 text-slate-400">Sign in to manage your flags and environments.</p>
          <div className="mt-8 space-y-4">
            <GoogleSignInButton onClick={handleGoogleLogin} disabled={projectLoading} />
            <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-slate-600"><span className="h-px flex-1 bg-white/[0.08]" /><span>or use email</span><span className="h-px flex-1 bg-white/[0.08]" /></div>
          </div>
          <form onSubmit={handleLogin} className="mt-5 space-y-5">
            <div><label htmlFor="login-email" className="mb-2 block text-sm font-medium text-slate-300">Email address</label><input id="login-email" autoComplete="email" type="email" placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} required className="input-control !py-3" /></div>
            <div><div className="mb-2 flex items-center justify-between"><label htmlFor="login-password" className="block text-sm font-medium text-slate-300">Password</label></div><input id="login-password" autoComplete="current-password" type="password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required className="input-control !py-3" /></div>
            <button type="submit" disabled={submitting || projectLoading} className="btn-primary w-full !py-3">{projectLoading ? "Restoring session…" : submitting ? "Signing in…" : "Sign in"}<span aria-hidden="true">→</span></button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-500">New to FlagPilot? <Link to={afterLogin !== "/dashboard" ? `/register?next=${encodeURIComponent(afterLogin)}` : "/register"} className="font-medium text-indigo-300 hover:text-indigo-200">Create an account</Link></p>
          <p className="mt-10 text-center text-xs leading-5 text-slate-600">Use your work account to continue.</p>
        </div>
      </section>
    </main>
  );
}

export default Login;
