import { SecurityError } from "./errors.js";
import { readSafeUtf8 } from "./fs-safe.js";
import { parsePluginRegistry } from "./plugin-registry.js";

const REQUIRED_TEXT_FILES = [
  "README.md",
  "LICENSE",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "docs/threat-model.md",
  "docs/adapter-contract.md",
  "docs/phase1-acceptance.md",
  "docs/compatibility.md",
  "docs/example-session.md",
  "docs/project-guidebook.md",
  "docs/rollout-plan.md",
  "docs/recorder-sdk.md",
];

function parseJson(text, label) {
  try { return JSON.parse(text); } catch { throw new SecurityError(`${label} is not valid JSON.`); }
}

/**
 * Runs deterministic repository-readiness checks. It intentionally does not claim
 * to scan user transcripts or prove absence of secrets/vulnerabilities.
 */
export async function checkReleaseReadiness() {
  const packageJson = parseJson(await readSafeUtf8("package.json", 128 * 1024), "package.json");
  if (
    packageJson.name !== "context-ledger" ||
    typeof packageJson.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(packageJson.version) ||
    packageJson.type !== "module" ||
    packageJson.license !== "Apache-2.0" ||
    !packageJson.private ||
    (packageJson.dependencies && Object.keys(packageJson.dependencies).length > 0) ||
    (packageJson.optionalDependencies && Object.keys(packageJson.optionalDependencies).length > 0)
  ) throw new SecurityError("package.json does not meet the Context Ledger Git-release policy.");

  for (const filename of REQUIRED_TEXT_FILES) {
    const text = await readSafeUtf8(filename, 512 * 1024);
    if (text.trim().length === 0) throw new SecurityError(`${filename} must not be empty.`);
  }
  const registry = parsePluginRegistry(await readSafeUtf8("plugins/registry.json", 128 * 1024));
  return {
    ready: true,
    version: packageJson.version,
    distribution: "Git source release only; npm publishing remains blocked by package.json private: true.",
    runtimeDependencies: 0,
    requiredDocuments: REQUIRED_TEXT_FILES,
    adapterManifests: registry.adapters.length,
    limitation: "This validates project release metadata, not the absence of vulnerabilities, secrets, or hostile local files.",
  };
}
