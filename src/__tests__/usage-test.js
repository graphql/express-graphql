// @flow strict

import express from 'express';
import request from 'supertest';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { GraphQLSchema } from 'graphql';

import { graphqlHTTP } from '../index';

describe('Useful errors when incorrectly used', () => {
  it('requires an option factory function', () => {
    expect(() => {
      // $DisableFlowOnNegativeTest
      graphqlHTTP();
    }).to.throw('GraphQL middleware requires options.');
  });

  it('requires option factory function to return object', async () => {
    const app = express();

    app.use(
      '/graphql',
      // $DisableFlowOnNegativeTest
      graphqlHTTP(() => null),
    );

    const response = await request(app).get('/graphql?query={test}');

    expect(response.status).to.equal(500);
    expect(JSON.parse(response.text)).to.deep.equal({
      errors: [
        {
          message:
            'GraphQL middleware option function must return an options object or a promise which will be resolved to an options object.',
        },
      ],
    });
  });

  it('requires option factory function to return object or promise of object', async () => {
    const app = express();

    app.use(
      '/graphql',
      // $DisableFlowOnNegativeTest
      graphqlHTTP(() => Promise.resolve(null)),
    );

    const response = await request(app).get('/graphql?query={test}');

    expect(response.status).to.equal(500);
    expect(JSON.parse(response.text)).to.deep.equal({
      errors: [
        {
          message:
            'GraphQL middleware option function must return an options object or a promise which will be resolved to an options object.',
        },
      ],
    });
  });

  it('requires option factory function to return object with schema', async () => {
    const app = express();

    app.use(
      '/graphql',
      // $DisableFlowOnNegativeTest
      graphqlHTTP(() => ({})),
    );

    const response = await request(app).get('/graphql?query={test}');

    expect(response.status).to.equal(500);
    expect(JSON.parse(response.text)).to.deep.equal({
      errors: [
        { message: 'GraphQL middleware options must contain a schema.' },
      ],
    });
  });

  it('requires option factory function to return object or promise of object with schema', async () => {
    const app = express();

    app.use(
      '/graphql',
      // $DisableFlowOnNegativeTest
      graphqlHTTP(() => Promise.resolve({})),
    );

    const response = await request(app).get('/graphql?query={test}');

    expect(response.status).to.equal(500);
    expect(JSON.parse(response.text)).to.deep.equal({
      errors: [
        { message: 'GraphQL middleware options must contain a schema.' },
      ],
    });
  });

  it('validates schema before executing request', async () => {
    // $DisableFlowOnNegativeTest
    const schema = new GraphQLSchema({ directives: [null] });

    const app = express();

    app.use(
      '/graphql',
      graphqlHTTP(() => Promise.resolve({ schema })),
    );

    const response = await request(app).get('/graphql?query={test}');

    expect(response.status).to.equal(500);
    expect(JSON.parse(response.text)).to.deep.equal({
      errors: [
        { message: 'Query root type must be provided.' },
        { message: 'Expected directive but got: null.' },
      ],
    });
  });
});
