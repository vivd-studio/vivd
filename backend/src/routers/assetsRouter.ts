import { router } from "../trpc";
import { assetsFilesystemProcedures } from "./assets/filesystem";
import { assetsAiImageProcedures } from "./assets/aiImages";

export const assetsRouter = router({
  ...assetsFilesystemProcedures,
  ...assetsAiImageProcedures,
});
