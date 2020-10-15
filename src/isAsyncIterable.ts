export function isAsyncIterable<T>(
  maybeAsyncIterable: any,
  // eslint-disable-next-line no-undef
): maybeAsyncIterable is AsyncIterable<T> {
  if (maybeAsyncIterable == null || typeof maybeAsyncIterable !== 'object') {
    return false;
  }
  return typeof maybeAsyncIterable[Symbol.asyncIterator] === 'function';
}
