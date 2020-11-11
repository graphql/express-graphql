export function isAsyncIterable<T>(
  maybeAsyncIterable: any,
): maybeAsyncIterable is AsyncIterable<T> {
  if (maybeAsyncIterable == null || typeof maybeAsyncIterable !== 'object') {
    return false;
  }
  return typeof maybeAsyncIterable[Symbol.asyncIterator] === 'function';
}
