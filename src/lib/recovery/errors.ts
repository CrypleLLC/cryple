export class RecoveryValidationError extends Error {
  constructor(message: string, name = 'RecoveryValidationError') {
    super(message);
    this.name = name;
  }
}
