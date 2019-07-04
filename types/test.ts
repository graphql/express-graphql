import graphqlHTTP = require('express-graphql');
import { buildSchema } from 'graphql';

const schema = buildSchema(`type Query { hello: String }`);

const validationRules = [
  () => ({ Field: () => false }),
  () => ({ Variable: () => true }),
];

graphqlHTTP({
  graphiql: true,
  schema,
  customFormatErrorFn: (error: Error) => ({
    message: error.message,
  }),
  validationRules,
  extensions: ({ document, variables, operationName, result }) => ({
    key: 'value',
    key2: 'value',
  }),
});

graphqlHTTP(request => ({
  graphiql: true,
  schema,
  context: request.headers,
  validationRules,
}));

graphqlHTTP(async request => {
  return {
    graphiql: true,
    schema: await Promise.resolve(schema),
    context: request.headers,
    extensions: (args: graphqlHTTP.RequestInfo) => ({}),
    validationRules,
  };
});
