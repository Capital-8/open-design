import {
  LAUNCHER_HOST_CONTRACT_VERSION, validateLauncherApplicationArtifact,
  type LauncherHostEnvironment, type LauncherApplicationArtifact,
} from "@open-design/launcher-proto";

export function buildLauncherHostEnvironment(input: Omit<LauncherHostEnvironment, "contractVersion">): LauncherHostEnvironment {
  return { contractVersion: LAUNCHER_HOST_CONTRACT_VERSION, ...input };
}
/** Runtime and packaging consume exactly the same portable artifact contract. */
export function buildLauncherApplicationArtifact(input: LauncherApplicationArtifact): LauncherApplicationArtifact {
  return validateLauncherApplicationArtifact(input, input);
}
