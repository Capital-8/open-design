import {
  checkHostUpdater,
  clearHostUpdaterCache,
  downloadHostUpdater,
  getHostUpdaterStatus,
  installHostUpdater,
  isOpenDesignHostAvailable,
  quitHostAfterUpdaterInstallerOpen,
  setHostUpdaterMenuLabels,
  subscribeHostUpdater,
  subscribeHostUpdaterOpenDialog,
  type OpenDesignHostActionResult,
  type OpenDesignHostUpdaterActionOptions,
  type OpenDesignHostUpdaterMenuLabels,
  type OpenDesignHostUpdaterOpenDialogListener,
  type OpenDesignHostUpdaterResult,
  type OpenDesignHostUpdaterStatusListener,
  type OpenDesignHostUpdaterStatusSnapshot,
} from '@open-design/host';
import { deriveUpdaterModelWithAvailability } from './shared';
import type { UpdaterActionResult, UpdaterModel } from './shared';

export function deriveUpdaterModel(
  status: OpenDesignHostUpdaterStatusSnapshot | null,
  options: { hostAvailable?: boolean } = {},
): UpdaterModel {
  return deriveUpdaterModelWithAvailability(status, {
    hostAvailable: options.hostAvailable ?? isOpenDesignHostAvailable(),
  });
}
function modelFromHostResult(result: OpenDesignHostUpdaterResult): UpdaterActionResult {
  if (!result.ok) return result;
  return {
    ok: true,
    model: deriveUpdaterModel(result.status, { hostAvailable: true }),
    status: result.status,
  };
}

export async function readUpdaterStatus(
  options?: OpenDesignHostUpdaterActionOptions,
): Promise<UpdaterActionResult> {
  return modelFromHostResult(await getHostUpdaterStatus(options));
}

export async function checkForUpdaterUpdate(
  options?: OpenDesignHostUpdaterActionOptions,
): Promise<UpdaterActionResult> {
  return modelFromHostResult(await checkHostUpdater(options));
}

export async function downloadUpdaterUpdate(
  options?: OpenDesignHostUpdaterActionOptions,
): Promise<UpdaterActionResult> {
  return modelFromHostResult(await downloadHostUpdater(options));
}

export async function openUpdaterInstaller(
  options?: OpenDesignHostUpdaterActionOptions,
): Promise<UpdaterActionResult> {
  return modelFromHostResult(await installHostUpdater(options));
}

export async function clearUpdaterCache(
  options?: OpenDesignHostUpdaterActionOptions,
): Promise<UpdaterActionResult> {
  return modelFromHostResult(await clearHostUpdaterCache(options));
}

export async function quitAfterUpdaterInstallerOpen(
  options?: OpenDesignHostUpdaterActionOptions,
): Promise<OpenDesignHostActionResult> {
  return await quitHostAfterUpdaterInstallerOpen(options);
}

export function subscribeToUpdaterStatus(
  listener: OpenDesignHostUpdaterStatusListener,
): () => void {
  return subscribeHostUpdater(listener);
}

export function subscribeToUpdaterOpenDialog(
  listener: OpenDesignHostUpdaterOpenDialogListener,
): () => void {
  return subscribeHostUpdaterOpenDialog(listener);
}

export async function syncUpdaterMenuLabels(
  labels: OpenDesignHostUpdaterMenuLabels,
): Promise<OpenDesignHostActionResult> {
  return await setHostUpdaterMenuLabels(labels);
}
