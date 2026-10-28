import { startProcess, type CloudProcess, type ProcessOptions } from './process.js';

/** HTTP and run jobs will be enabled modules; no business modules are installed in phase one. */
export function startMain(options: ProcessOptions): Promise<CloudProcess> {
  return startProcess(options);
}
