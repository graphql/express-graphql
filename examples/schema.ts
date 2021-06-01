import { buildSchema } from 'graphql';

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export const schema = buildSchema(`
type Query {
    hello: String
}
type Subscription {
    countDown: Int
}
`);

export const roots = {
  Query: {
    hello: () => 'Hello World!',
  },
  subscription: {
    /* eslint no-await-in-loop: "off" */

    countDown: async function* fiveToOne() {
      for (const number of [5, 4, 3, 2, 1]) {
        await sleep(1000); // slow down a bit so user can see the count down on GraphiQL
        yield { countDown: number };
      }
    },
  },
};

export const rootValue = {
  hello: roots.Query.hello,
  countDown: roots.subscription.countDown,
};
