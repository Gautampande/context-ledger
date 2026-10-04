import { createHash } from "node:crypto";

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

export function sha256Text(text) {
  return sha256(Buffer.from(text, "utf8"));
}
