import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useContext } from "react";
import { AuthContext } from "./context/auth-context.js";
import { Toaster } from "react-hot-toast";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Analytics from "./pages/Analytics.jsx";
import Logs from "./pages/Logs.jsx";
import DeveloperSetup from "./pages/DeveloperSetup.jsx";
import AuditActivity from "./pages/AuditActivity.jsx";
import InvitationAccept from "./pages/InvitationAccept.jsx";
import Integrations from "./pages/Integrations.jsx";

const PrivateRoute = ({ children }) => {
  const { user, projectLoading } = useContext(AuthContext);
  if (projectLoading) return <div className="min-h-screen bg-[#09090b] text-slate-400 grid place-items-center">Restoring session…</div>;
  return user ? children : <Navigate to="/login" replace />;
};

const HomeRedirect = () => {
  const { user, projectLoading } = useContext(AuthContext);
  if (projectLoading) return <div className="min-h-screen bg-[#09090b] text-slate-400 grid place-items-center">Restoring session…</div>;
  return <Navigate to={user ? "/dashboard" : "/login"} replace />;
};

function App() {
  return (
    <BrowserRouter>
        <Toaster position="top-right" toastOptions={{ style: { background: "#18181b", color: "#f4f4f5", border: "1px solid #3f3f46", borderRadius: "8px" } }} />
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/invite/accept" element={<InvitationAccept />} />
          <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/analytics" element={<PrivateRoute><Analytics /></PrivateRoute>} />
          <Route path="/logs" element={<PrivateRoute><Logs /></PrivateRoute>} />
          <Route path="/activity" element={<PrivateRoute><AuditActivity /></PrivateRoute>} />
          <Route path="/integrations" element={<PrivateRoute><Integrations /></PrivateRoute>} />
          <Route path="/developers" element={<PrivateRoute><DeveloperSetup /></PrivateRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    </BrowserRouter>
  );
}

export default App;
