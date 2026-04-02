import { Outlet } from "react-router";
import { AuthProvider } from "./AuthContext";

export function AuthLayout() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}
