import { Navigate, Outlet } from "react-router";
import { useAuth } from "./AuthContext";

export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}
