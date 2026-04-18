export const installedPluginRegistry = Object.freeze([
  {
    packageName: "@vivd/plugin-google-maps",
    workspaceDir: "plugins/external/google-maps",
    manifestImport: "@vivd/plugin-google-maps/manifest",
  },
  {
    packageName: "@vivd/plugin-contact-form",
    workspaceDir: "plugins/native/contact-form",
    manifestImport: "@vivd/plugin-contact-form/manifest",
    surfaceImports: {
      backend: "@vivd/plugin-contact-form/backend/plugin",
      frontend: "@vivd/plugin-contact-form/frontend/plugin",
      cli: "@vivd/plugin-contact-form/cli/plugin",
    },
  },
  {
    packageName: "@vivd/plugin-analytics",
    workspaceDir: "plugins/native/analytics",
    manifestImport: "@vivd/plugin-analytics/manifest",
    surfaceImports: {
      backend: "@vivd/plugin-analytics/backend/plugin",
      frontend: "@vivd/plugin-analytics/frontend/plugin",
      cli: "@vivd/plugin-analytics/cli/plugin",
    },
  },
  {
    packageName: "@vivd/plugin-newsletter",
    workspaceDir: "plugins/native/newsletter",
    manifestImport: "@vivd/plugin-newsletter/manifest",
    surfaceImports: {
      backend: "@vivd/plugin-newsletter/backend/plugin",
      frontend: "@vivd/plugin-newsletter/frontend/plugin",
      cli: "@vivd/plugin-newsletter/cli/plugin",
    },
  },
  {
    packageName: "@vivd/plugin-table-booking",
    workspaceDir: "plugins/native/table-booking",
    manifestImport: "@vivd/plugin-table-booking/manifest",
    surfaceImports: {
      backend: "@vivd/plugin-table-booking/backend/plugin",
      frontend: "@vivd/plugin-table-booking/frontend/plugin",
      cli: "@vivd/plugin-table-booking/cli/plugin",
    },
  },
]);
