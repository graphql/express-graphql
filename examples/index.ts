import { createServer } from 'http';

import express from 'express';
import { execute, subscribe, buildSchema } from 'graphql';
import { SubscriptionServer } from 'subscriptions-transport-ws';

import { graphqlHTTP } from '../src';

// Construct a schema, using GraphQL schema language
const schema = buildSchema(`
  type Query {
    hello: String!
  }

  type Subscription {
    currentTime: String!
  }
`);

// The root provides a resolver function for each API endpoint
const rootValue = {
  hello: () => 'Hello world!',
  currentTime: () => currentTimeGenerator(),
};

async function* currentTimeGenerator() {
  while (true) {
    const currentTime = (new Date()).toLocaleTimeString();
    console.log('Pushed current time over subscriptions: ' + currentTime);
    yield { currentTime };

    await later(1);
  }
}

function later(delayInSeconds: number) {
  return new Promise((resolve) => setTimeout(resolve, delayInSeconds * 1000));
}

const PORT = 4001;
const app = express();
app.use(
  '/graphql',
  graphqlHTTP({
    schema,
    rootValue,
    graphiql: {
      headerEditorEnabled: true,
      subscriptionEndpoint: `ws://localhost:${PORT}/subscriptions`,
    },
  }),
);

const ws = createServer(app);

ws.listen(PORT, () => {
  // Set up the WebSocket for handling GraphQL subscriptions.
  SubscriptionServer.create(
    {
      execute,
      subscribe,
      schema,
      rootValue,
    },
    {
      server: ws,
      path: '/subscriptions',
    },
  );
});

console.log(`Running a GraphQL API server at http://localhost:${PORT}/graphql`);
