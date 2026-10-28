import type { BridgeCapability } from '@open-design/bridge';

export interface ModuleRequirements {
  readonly name: string;
  readonly required: readonly BridgeCapability[];
}

/** Consumers declare needs; supplying fewer adapters cannot weaken those needs. */
export function collectRequirements(modules: readonly ModuleRequirements[]): readonly BridgeCapability[] {
  if (modules.length === 0) throw new Error('Cloud startup requires at least one enabled module');
  const names = new Set<string>();
  const required = new Set<BridgeCapability>();
  for (const module of modules) {
    if (!module.name.trim() || names.has(module.name)) {
      throw new Error(`Invalid or duplicate cloud module: ${module.name}`);
    }
    names.add(module.name);
    for (const capability of module.required) required.add(capability);
  }
  return Object.freeze([...required]);
}
