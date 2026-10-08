/** First byte must arrive within this window or the request fails. */
export const FIRST_CHUNK_TIMEOUT_MS = 30_000;

/** No-chunk gap allowed mid-stream before the request fails. */
export const IDLE_TIMEOUT_MS = 30_000;

/**
 * Thrown when upstream stops producing bytes for too long. The message is
 * prefixed "Service unavailable:" on purpose — `SERVICE_UNAVAILABLE_PATTERN`
 * classifies it into the existing failure dialog with zero client changes.
 */
export class StreamTimeoutError extends Error {
  constructor(model: string) {
    super(
      `Service unavailable: ${model} timed out waiting for a response — switch model and retry.`,
    );
    this.name = "StreamTimeoutError";
  }
}

/**
 * Races a promise against a deadline. Handlers are attached to the source
 * promise immediately, so a late settlement after the timeout wins can never
 * surface as an unhandled rejection. `onTimeout` runs before the rejection
 * propagates — the route uses it to abort the upstream request.
 */
export function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => Error,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
