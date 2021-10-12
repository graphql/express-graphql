const express  = require('express');
const { graphqlHTTP } = require('express-graphql');
const { buildSchema } = require('graphql');

// Construct a schema, using GraphQL schema language
var schema = buildSchema(`
  type Query {
    hello: String
    deferTest: GraphQLDeferTest
  }

  type GraphQLDeferTest {
    text: String
    defferedText: String
  }
`);

const sleep = (t = 1000) => new Promise((res) => setTimeout(res, t));

// Model
class GraphQLDeferTest {
  constructor() {}

  async text() {
    return "Peter Parker"
  }

  async defferedText() {
    await sleep(5000)

    return 'Took a long time, he?'
  }
}

// Query resolvers
var root = {
  hello: () => 'Hello World',
  deferTest: async () => new GraphQLDeferTest(),
};

var app = express();

app.use('/graphql', graphqlHTTP({
  schema: schema,
  rootValue: root,
  graphiql: true,
}));

app.listen(4040)
console.log('Running a GraphQL API server at http://localhost:4040/graphql');
