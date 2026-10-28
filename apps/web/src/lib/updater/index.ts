export {
  deriveUpdaterModel,
  readUpdaterStatus,
  checkForUpdaterUpdate,
  downloadUpdaterUpdate,
  openUpdaterInstaller,
  clearUpdaterCache,
  quitAfterUpdaterInstallerOpen,
  subscribeToUpdaterStatus,
  subscribeToUpdaterOpenDialog,
  syncUpdaterMenuLabels,
} from '@web-target/lib/updater';
export {
  UPDATER_DOWNLOAD_FAILED_CODE,
  isUpdaterDownloadFailure,
  restartSafetyFromUpdaterStatus,
  restartSafetyFromActionResult,
} from './shared';
export type {
  UpdaterEnvironment,
  UpdaterDownloadProgress,
  UpdaterActionResult,
  UpdaterRestartSafety,
  UpdaterModel,
} from './shared';
