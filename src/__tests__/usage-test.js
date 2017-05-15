/**
 *  Copyright (c) 2015, Facebook, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 */

// 80+ char lines are useful in describe/it, so ignore in this file.
/* eslint-disable max-len */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import request from 'supertest';
import express from 'express';
import graphqlHTTP from '../';


describe('Useful errors when incorrectly used', () => {

  it('requires an option factory function', () => {
    expect(() => {
      graphqlHTTP();
    }).to.throw(
      'GraphQL middleware requires options.'
    );
  });

  it('requires option factory function to return object', async () => {
    const app = express();

    app.use('/graphql', graphqlHTTP(() => null));

    const response = await request(app).get('/graphql?query={test}');

    expect(response.status).to.equal(500);
    expect(JSON.parse(response.text)).to.deep.equal({
      errors: [
        { message:
          'GraphQL middleware option function must return an options object or a promise which will be resolved to an options object.' }
      ]
    });
  });

  it('requires option factory function to return object or promise of object', async () => {
    const app = express();

    app.use('/graphql', graphqlHTTP(() => Promise.resolve(null)));

    const response = await request(app).get('/graphql?query={test}');

    expect(response.status).to.equal(500);
    expect(JSON.parse(response.text)).to.deep.equal({
      errors: [
        { message:
          'GraphQL middleware option function must return an options object or a promise which will be resolved to an options object.' }
      ]
    });
  });

  it('requires option factory function to return object with schema', async () => {
    const app = express();

    app.use('/graphql', graphqlHTTP(() => ({})));

    const response = await request(app).get('/graphql?query={test}');

    expect(response.status).to.equal(500);
    expect(JSON.parse(response.text)).to.deep.equal({
      errors: [
        { message: 'GraphQL middleware options must contain a schema.' }
      ]
    });
  });

  it('requires option factory function to return object or promise of object with schema', async () => {
    const app = express();

    app.use('/graphql', graphqlHTTP(() => Promise.resolve({})));

    const response = await request(app).get('/graphql?query={test}');

    expect(response.status).to.equal(500);
    expect(JSON.parse(response.text)).to.deep.equal({
      errors: [
        { message: 'GraphQL middleware options must contain a schema.' }
      ]
    });
  });

});
