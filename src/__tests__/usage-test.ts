import express from 'express';
import request from 'supertest';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
} from 'graphql';

import { graphqlHTTP } from '../index';

describe('Useful errors when incorrectly used', () => {
  it('requires an option factory function', () => {
    expect(() => {
      // @ts-expect-error
      graphqlHTTP();
    }).to.throw('GraphQL middleware requires options.');
  });

  it('requires option factory function to return object', async () => {
    const app = express();

    app.use(
      '/graphql',
      // @ts-expect-error
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
      // @ts-expect-error
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
      // @ts-expect-error
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
      // @ts-expect-error
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

  it('uses the custom runtime query error handling function', async () => {
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'QueryRoot',
        fields: {
          test: {
            type: new GraphQLNonNull(GraphQLString),
            resolve() {
              throw new Error('Throws!');
            },
          },
        },
      }),
    });

    const app = express();

    app.use(
      '/graphql',
      graphqlHTTP({
        handleRuntimeQueryErrorFn(_, response) {
          response.setHeader('customRuntimeQueryError', "I'm a teapot");
          response.statusCode = 418;
        },
        schema,
      }),
    );

    const response = await request(app).get('/graphql?query={test}');

    expect(response.status).to.equal(418);
    expect(response.get('customRuntimeQueryError')).to.equal("I'm a teapot");
  });

  it('validates schema before executing request', async () => {
    // @ts-expect-error
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
