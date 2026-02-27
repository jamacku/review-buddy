export class ReviewBuddyError extends Error {
  constructor(
    message: string,
    readonly code?: number
  ) {
    super(message);
  }
}

export function raise(message: string, code?: number): never {
  throw new ReviewBuddyError(message, code);
}
