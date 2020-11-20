import { expect } from 'chai';
import { describe, it } from 'mocha';

import { isAsyncIterable } from '../isAsyncIterable';

describe('isAsyncIterable', () => {
  it('returns false for null', () => {
    expect(isAsyncIterable(null)).to.equal(false);
  });
  it('returns false for non-object', () => {
    expect(isAsyncIterable(1)).to.equal(false);
  });
  it('returns true for async generator function', () => {
    // istanbul ignore next: test function
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const myGen = async function* () {};
    const result = myGen();
    expect(isAsyncIterable(result)).to.equal(true);
  });
});
