import { useContext } from "react";
import { AuthContext } from "../context/auth-context.js";
import { Navigate } from "react-router-dom";

const ProtectedRoute = ({ children }) => {
  const { user, projectLoading } = useContext(AuthContext);

  if (projectLoading) return <div>Restoring session…</div>;
  if (!user) return <Navigate to="/login" replace />;

  return children;
};

export default ProtectedRoute;