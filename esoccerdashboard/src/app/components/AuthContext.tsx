import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { fetchStrategies, login as apiLogin, logout as apiLogout } from "../services/api";

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
  isLoading: true,
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Probe session: GET /strategies is auth-protected, no side effects
    // TODO: replace with GET /auth/me when backend adds it
    fetchStrategies()
      .then(() => setIsAuthenticated(true))
      .catch(() => setIsAuthenticated(false))
      .finally(() => setIsLoading(false));

    const handleUnauthorized = () => {
      setIsAuthenticated(false);
    };
    window.addEventListener("auth:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("auth:unauthorized", handleUnauthorized);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    await apiLogin(username, password);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setIsAuthenticated(false);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
