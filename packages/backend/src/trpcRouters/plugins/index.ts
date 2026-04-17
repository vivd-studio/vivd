import { router } from "../../trpc";
import { catalogPluginProcedure } from "./catalog";
import {
  ensurePluginProcedure,
  infoPluginProcedure,
  requestPluginAccessProcedure,
  readPluginProcedure,
  runPluginActionProcedure,
  updatePluginConfigProcedure,
} from "./generic";
import { tableBookingRouter } from "./tableBooking";

export const pluginsRouter = router({
  catalog: catalogPluginProcedure,
  ensure: ensurePluginProcedure,
  info: infoPluginProcedure,
  requestAccess: requestPluginAccessProcedure,
  read: readPluginProcedure,
  updateConfig: updatePluginConfigProcedure,
  action: runPluginActionProcedure,
  tableBooking: tableBookingRouter,
});
