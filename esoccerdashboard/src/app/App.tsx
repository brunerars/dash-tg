import { RouterProvider } from "react-router";
import { router } from "./routes";
import { ThemeProvider } from "./components/ThemeContext";
import { AuthProvider } from "./components/AuthContext";
import { SessionProvider } from "./components/SessionContext";

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
