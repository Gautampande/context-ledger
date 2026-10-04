import { SecurityError } from "./errors.js";

export const ADAPTER_MANIFEST_SCHEMA = "context-ledger-adapter-manifest/0.1";

const FIELDS = new Set(["schema", "id", "name", "version", "inputFormat", "capabilities", "securityContact"]);
const REGISTRY_FIELDS = new Set(["schema", "adapters"]);

function validText(value, max) {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function validateAdapterManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || Object.keys(manifest).some((key) => !FIELDS.has(key))) {
    throw new SecurityError("Adapter manifest is not a supported object.");
  }
  if (
    manifest.schema !== ADAPTER_MANIFEST_SCHEMA ||
    !/^[a-z][a-z0-9-]{1,62}$/u.test(manifest.id) ||
    !validText(manifest.name, 80) ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/u.test(manifest.version) ||
    manifest.inputFormat !== "context-ledger-import/0.1" ||
    !Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0 || manifest.capabilities.some((item) => item !== "normalize-only") ||
    !validText(manifest.securityContact, 200)
  ) throw new SecurityError("Adapter manifest is invalid.");
  return manifest;
}

export function parsePluginRegistry(text) {
  let registry;
  try { registry = JSON.parse(text); } catch { throw new SecurityError("Plugin registry is not valid JSON."); }
  if (!registry || typeof registry !== "object" || Array.isArray(registry) || Object.keys(registry).some((key) => !REGISTRY_FIELDS.has(key)) || registry.schema !== "context-ledger-plugin-registry/0.1" || !Array.isArray(registry.adapters) || registry.adapters.length > 100) {
    throw new SecurityError("Plugin registry is invalid.");
  }
  const ids = new Set();
  for (const manifest of registry.adapters) {
    validateAdapterManifest(manifest);
    if (ids.has(manifest.id)) throw new SecurityError("Plugin registry has duplicate adapter IDs.");
    ids.add(manifest.id);
  }
  return registry;
}
