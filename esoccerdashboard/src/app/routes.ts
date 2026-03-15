import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { HomePage } from "./components/HomePage";
import { DalePage } from "./components/DalePage";
import { OverUnderPage } from "./components/OverUnderPage";
import { BlueprintPage } from "./components/BlueprintPage";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: HomePage },
      { path: "dale", Component: DalePage },
      { path: "over-under", Component: OverUnderPage },
      { path: "blueprint/:cacheKey", Component: BlueprintPage },
    ],
  },
]);
