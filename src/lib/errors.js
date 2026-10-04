export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

export class SecurityError extends Error {
  constructor(message) {
    super(message);
    this.name = "SecurityError";
  }
}
