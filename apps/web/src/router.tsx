import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { ExplorerPage } from "@/components/explorer";
import { validateExplorerSearch } from "@/lib/search";
import { AccountPage } from "@/routes/account";
import { AdminPage } from "@/routes/admin";
import { CatalogPage, DownloadPage } from "@/routes/public";
import { PortalPage } from "@/routes/portal";
import { SecurityPage } from "@/routes/security";
import { SettingsPage } from "@/routes/settings";
import { SignInPage } from "@/routes/sign-in";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 0 } },
});

const rootRoute = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <Toaster position="top-right" />
    </>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: function IndexRedirect() {
    window.location.replace("/app");
    return null;
  },
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  component: SignInPage,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app",
  component: () => <Outlet />,
});

const appIndexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: ExplorerPage,
});

const projectRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "p/$projectId",
  validateSearch: validateExplorerSearch,
  component: ExplorerPage,
});

const explorerRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "p/$projectId/d/$drawerId/f/$folderId",
  validateSearch: validateExplorerSearch,
  component: ExplorerPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "p/$projectId/settings",
  component: SettingsPage,
});

const accountRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "account",
  component: AccountPage,
});

const adminRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "admin",
  component: AdminPage,
});

const securityRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "security",
  component: SecurityPage,
});

const portalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/portal/$slug",
  validateSearch: (search: Record<string, unknown>) => {
    const token = typeof search.token === "string" ? search.token : "";
    return token ? { token } : {};
  },
  component: PortalPage,
});

const portalFolderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/portal/$slug/f/$folderId",
  component: PortalPage,
});

const downloadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/d/$publicId",
  component: DownloadPage,
});

const catalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/catalog/$tenantSlug",
  component: CatalogPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  signInRoute,
  appRoute.addChildren([appIndexRoute, projectRoute, explorerRoute, settingsRoute, accountRoute, adminRoute, securityRoute]),
  portalRoute,
  portalFolderRoute,
  downloadRoute,
  catalogRoute,
]);

const router = createRouter({ routeTree });

export function AppRouter() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
