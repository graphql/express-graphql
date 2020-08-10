'use strict';

const assert = require('assert');

const { buildSchema } = require('graphql');

const { graphqlHTTP } = require('express-graphql');

const schema = buildSchema('type Query { hello: String }');

const middleware = graphqlHTTP({
  graphiql: true,
  schema,
  rootValue: { hello: 'world' },
});

assert(typeof middleware === 'function');

const request = {
  url: 'http://example.com',
  method: 'GET',
  headers: {},
  body: {
    query: '{ hello }',
  },
};

const response = {
  headers: {},
  setHeader(name, value) {
    this.headers[name] = value;
  },
  text: null,
  end(buffer) {
    this.text = buffer.toString();
  },
};

middleware(request, response).then(() => {
  assert.deepStrictEqual(response.headers, {
    'Content-Length': '26',
    'Content-Type': 'application/json; charset=utf-8',
  });
  assert.deepStrictEqual(response.text, '{"data":{"hello":"world"}}');
});
