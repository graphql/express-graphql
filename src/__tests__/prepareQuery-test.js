import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import { GraphQLSchema, GraphQLObjectType, GraphQLString } from 'graphql';
import { prepareQuery } from '../prepareQuery';

const TestSchema1 = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: 'QueryRoot',
    fields: {
      ping: { type: GraphQLString, resolve: () => 'pong' },
    },
  }),
});

const TestSchema2 = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: 'QueryRoot',
    fields: {
      ping: { type: GraphQLString, resolve: () => 'pong' },
    },
  }),
});

describe('Prepare query function', () => {
  beforeEach(() => prepareQuery.cache.clear());

  it('will fail for invalid queries', () => {
    expect(() => {
      prepareQuery('{test}', TestSchema1);
    }).to.throw(
      'Failed to validate GraphQL query.'
    );
  });

  it('will cache queries', () => {
    expect(prepareQuery('{ping}', TestSchema1))
    .to.equal(prepareQuery('{ping}', TestSchema1));
  });

  it('will fail for a query that has been cached with another schema', () => {
    prepareQuery('{ping}', TestSchema1);

    expect(() => {
      prepareQuery('{ping}', TestSchema2);
    }).to.throw(
      'Can’t prepare a query with a different schemas.'
    );
  });
});
