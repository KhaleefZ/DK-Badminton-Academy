/** An error whose message is safe to show to the user. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = () => new AppError(401, 'NOT_SIGNED_IN', 'Please sign in to continue.');
export const forbidden = () => new AppError(403, 'FORBIDDEN', 'You don’t have permission to do this.');
export const notFound = (what = 'That record') => new AppError(404, 'NOT_FOUND', `${what} wasn’t found.`);
export const invalid = (message: string, code = 'INVALID') => new AppError(400, code, message);
