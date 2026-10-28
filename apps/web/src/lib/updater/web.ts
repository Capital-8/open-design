import type {
  OpenDesignHostUpdaterStatusSnapshot,
  OpenDesignHostUpdaterActionOptions,
  OpenDesignHostUpdaterStatusListener,
  OpenDesignHostUpdaterOpenDialogListener,
  OpenDesignHostUpdaterMenuLabels,
  OpenDesignHostActionResult,
} from '@open-design/host';
import { deriveUpdaterModelWithAvailability } from './shared';
import type { UpdaterActionResult, UpdaterModel } from './shared';
export function deriveUpdaterModel(
  status: OpenDesignHostUpdaterStatusSnapshot | null,
  _options: { hostAvailable?: boolean } = {},
): UpdaterModel {
  return deriveUpdaterModelWithAvailability(status, { hostAvailable: false });
}
export async function readUpdaterStatus(
  _options?: OpenDesignHostUpdaterActionOptions,
): Promise<UpdaterActionResult> {
  return { ok: false, reason: 'host-unavailable' };
}
export const checkForUpdaterUpdate = readUpdaterStatus;
export const downloadUpdaterUpdate = readUpdaterStatus;
export const openUpdaterInstaller = readUpdaterStatus;
export const clearUpdaterCache = readUpdaterStatus;
export async function quitAfterUpdaterInstallerOpen(
  _options?: OpenDesignHostUpdaterActionOptions,
): Promise<OpenDesignHostActionResult> {
  return { ok: false, reason: 'host-unavailable' };
}
export function subscribeToUpdaterStatus(
  _listener: OpenDesignHostUpdaterStatusListener,
): () => void {
  return () => {};
}
export function subscribeToUpdaterOpenDialog(
  _listener: OpenDesignHostUpdaterOpenDialogListener,
): () => void {
  return () => {};
}
export async function syncUpdaterMenuLabels(
  _labels: OpenDesignHostUpdaterMenuLabels,
): Promise<OpenDesignHostActionResult> {
  return { ok: false, reason: 'host-unavailable' };
}
