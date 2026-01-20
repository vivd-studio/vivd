// Route path constants
export { ROUTES, isRoutePrefix } from "./paths";

// Guard components
export {
  RequireAuth,
  RequireAdmin,
  RequireAssignedProject,
  SingleProjectModeLayoutGuard,
  DashboardClientEditorGuard,
  ScratchWizardClientEditorGuard,
} from "./guards";

// Route configuration
export { AppRoutes } from "./routes";
