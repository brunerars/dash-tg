import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { HomePage } from "./components/HomePage";
import { DalePage } from "./components/DalePage";
import { OverUnderPage } from "./components/OverUnderPage";
import { BlueprintPage } from "./components/BlueprintPage";
import { LoginPage } from "./components/LoginPage";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AuthLayout } from "./components/AuthLayout";

export const router = createBrowserRouter([
  {
    Component: AuthLayout,
    children: [
      {
        path: "/login",
        Component: LoginPage,
      },
      {
        path: "/",
        Component: ProtectedRoute,
        children: [
          {
            Component: Layout,
            children: [
              { index: true, Component: HomePage },
              { path: "dale", Component: DalePage },
              { path: "over-under", Component: OverUnderPage },
              { path: "blueprint/:cacheKey", Component: BlueprintPage },
            ],
          },
        ],
      },
    ],
  },
]);
