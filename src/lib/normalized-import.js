import { sha256Text } from "./hash.js";
import { SecurityError } from "./errors.js";
import { validateNormalizedImport } from "./archive.js";

export function parseNormalizedImport(sourceText) {
  let document;
  try {
    document = JSON.parse(sourceText);
  } catch {
    throw new SecurityError("Normalized import is not valid JSON.");
  }
  validateNormalizedImport(document);
  return {
    document,
    sourceDocumentSha256: sha256Text(sourceText),
  };
}
