/**
 * Create an AsyncIterator from an EventEmitter. Useful for mocking a
 * PubSub system for tests.
 */
export default class SimplePubSub<T> {
  subscribers: Set<(arg0: T) => void>;

  constructor() {
    this.subscribers = new Set();
  }

  emit(event: T): boolean {
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
    return this.subscribers.size > 0;
  }

  // Use custom return type to avoid checking for optional `return` method
  getSubscriber(): AsyncGenerator<T, void, void> {
    type EventResolve = (arg0: IteratorResult<T>) => void;

    const pullQueue: Array<EventResolve> = [];
    const pushQueue: Array<T> = [];
    let listening = true;
    this.subscribers.add(pushValue);

    const emptyQueue = () => {
      listening = false;
      this.subscribers.delete(pushValue);
      for (const resolve of pullQueue) {
        resolve({ value: undefined, done: true });
      }
      pullQueue.length = 0;
      pushQueue.length = 0;
    };

    return {
      next(): Promise<IteratorResult<T>> {
        if (!listening) {
          return Promise.resolve({ value: undefined, done: true });
        }

        if (pushQueue.length > 0) {
          return Promise.resolve({
            value: pushQueue.shift() as T,
            done: false,
          });
        }
        return new Promise((resolve: EventResolve) => {
          pullQueue.push(resolve);
        });
      },
      return() {
        emptyQueue();
        return Promise.resolve({ value: undefined, done: true });
      },
      throw(error: unknown) {
        emptyQueue();
        return Promise.reject(error);
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };

    function pushValue(value: T): void {
      if (pullQueue.length > 0) {
        (pullQueue.shift() as EventResolve)({ value, done: false });
      } else {
        pushQueue.push(value);
      }
    }
  }
}
