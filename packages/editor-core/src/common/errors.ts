export class CoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends CoreError {}
export class RegistryError extends CoreError {}
export class TransactionError extends CoreError {}
export class DocumentError extends CoreError {}
export class RelationError extends CoreError {}
