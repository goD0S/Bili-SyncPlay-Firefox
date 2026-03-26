import { createSyncServer } from "./app.js";
import { loadRuntimeConfig } from "./config/runtime-config.js";

const { port, securityConfig, persistenceConfig, adminConfig, adminUiConfig } =
  await loadRuntimeConfig();

const { httpServer } = await createSyncServer(
  securityConfig,
  persistenceConfig,
  {
    adminConfig,
    adminUiConfig,
  },
);
httpServer.listen(port, () => {
  console.log(`Bili-SyncPlay server listening on http://localhost:${port}`);
});
