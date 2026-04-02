import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { useForm } from "react-hook-form";
import { useAuth } from "./AuthContext";
import { useTheme } from "./ThemeContext";

interface LoginForm {
  username: string;
  password: string;
}

export function LoginPage() {
  const { isAuthenticated, isLoading, login } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>();

  // Redirect already-authenticated users
  if (isLoading) return null;
  if (isAuthenticated) return <Navigate to="/" replace />;

  const onSubmit = async (data: LoginForm) => {
    setError("");
    setSubmitting(true);
    try {
      await login(data.username, data.password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao fazer login");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="flex items-center justify-center min-h-screen"
      style={{
        background: isDark ? "#0a0a0a" : "#f5f5f5",
      }}
    >
      <div
        className="w-full max-w-sm rounded-xl p-8"
        style={{
          background: isDark ? "rgba(255,255,255,0.03)" : "#ffffff",
          border: isDark ? "1px solid rgba(255,255,255,0.07)" : "1px solid #e5e5e5",
          boxShadow: isDark ? "0 8px 32px rgba(0,0,0,0.6)" : "0 4px 24px rgba(0,0,0,0.08)",
        }}
      >
        <div className="mb-8 text-center">
          <h1
            className="text-2xl font-bold mb-1"
            style={{ color: isDark ? "#f5f5f5" : "#0a0a0a" }}
          >
            Dashboard eSoccer
          </h1>
          <p
            className="text-sm"
            style={{ color: isDark ? "#737373" : "#737373" }}
          >
            Acesse sua conta
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: isDark ? "#a1a1a1" : "#525252" }}
            >
              Usuário
            </label>
            <input
              type="text"
              autoComplete="username"
              placeholder="usuario"
              {...register("username", { required: "Usuario obrigatorio" })}
              className="rounded-lg px-3 py-2 text-sm outline-none transition-all duration-150"
              style={{
                background: isDark ? "rgba(255,255,255,0.05)" : "#f9f9f9",
                border: isDark ? "1px solid rgba(255,255,255,0.1)" : "1px solid #d4d4d4",
                color: isDark ? "#f5f5f5" : "#0a0a0a",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#ea580c";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = isDark
                  ? "rgba(255,255,255,0.1)"
                  : "#d4d4d4";
              }}
            />
            {errors.username && (
              <span className="text-xs" style={{ color: "#ef4444" }}>
                {errors.username.message}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: isDark ? "#a1a1a1" : "#525252" }}
            >
              Senha
            </label>
            <input
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              {...register("password", { required: "Senha obrigatoria" })}
              className="rounded-lg px-3 py-2 text-sm outline-none transition-all duration-150"
              style={{
                background: isDark ? "rgba(255,255,255,0.05)" : "#f9f9f9",
                border: isDark ? "1px solid rgba(255,255,255,0.1)" : "1px solid #d4d4d4",
                color: isDark ? "#f5f5f5" : "#0a0a0a",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#ea580c";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = isDark
                  ? "rgba(255,255,255,0.1)"
                  : "#d4d4d4";
              }}
            />
            {errors.password && (
              <span className="text-xs" style={{ color: "#ef4444" }}>
                {errors.password.message}
              </span>
            )}
          </div>

          {error && (
            <div
              className="rounded-lg px-3 py-2 text-sm"
              style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                color: "#ef4444",
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 w-full rounded-lg py-2.5 text-sm font-semibold uppercase tracking-widest text-white transition-all duration-150 disabled:opacity-50"
            style={{
              background: submitting ? "#9a3412" : "#ea580c",
              cursor: submitting ? "not-allowed" : "pointer",
            }}
            onMouseEnter={(e) => {
              if (!submitting) e.currentTarget.style.background = "#c2410c";
            }}
            onMouseLeave={(e) => {
              if (!submitting) e.currentTarget.style.background = "#ea580c";
            }}
          >
            {submitting ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
