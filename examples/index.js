import express from 'express';
import { buildSchema } from 'graphql';

// eslint-disable-next-line node/no-missing-import, import/no-unresolved
import { graphqlHTTP } from 'graphql-express';

// Construct a schema, using GraphQL schema language
const schema = buildSchema(`
  type Query {
    hello: String
  }
`);

// The root provides a resolver function for each API endpoint
const rootValue = {
  hello: () => 'Hello world!',
};

const app = express();
app.use(
  '/graphql',
  graphqlHTTP({
    schema,
    rootValue,
    graphiql: true,
  }),
);
app.listen(4000);
console.log('Running a GraphQL API server at http://localhost:4000/graphql');
