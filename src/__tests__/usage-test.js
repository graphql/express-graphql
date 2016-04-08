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
import request from 'supertest-as-promised';
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
    var app = express();

    app.use('/graphql', graphqlHTTP(() => null));

    var caughtError;
    try {
      await request(app).get('/graphql?query={test}');
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError.response.status).to.equal(500);
    expect(JSON.parse(caughtError.response.text)).to.deep.equal({
      errors: [
        { message:
          'GraphQL middleware option function must return an options object.' }
      ]
    });
  });

  it('requires option factory function to return object or promise of object', async () => {
    var app = express();

    app.use('/graphql', graphqlHTTP(() => Promise.resolve(null)));

    var caughtError;
    try {
      await request(app).get('/graphql?query={test}');
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError.response.status).to.equal(500);
    expect(JSON.parse(caughtError.response.text)).to.deep.equal({
      errors: [
        { message:
          'GraphQL middleware option function must return an options object.' }
      ]
    });
  });

  it('requires option factory function to return object with schema', async () => {
    var app = express();

    app.use('/graphql', graphqlHTTP(() => ({})));

    var caughtError;
    try {
      await request(app).get('/graphql?query={test}');
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError.response.status).to.equal(500);
    expect(JSON.parse(caughtError.response.text)).to.deep.equal({
      errors: [
        { message: 'GraphQL middleware options must contain a schema.' }
      ]
    });
  });

  it('requires option factory function to return object or promise of object with schema', async () => {
    var app = express();

    app.use('/graphql', graphqlHTTP(() => Promise.resolve({})));

    var caughtError;
    try {
      await request(app).get('/graphql?query={test}');
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError.response.status).to.equal(500);
    expect(JSON.parse(caughtError.response.text)).to.deep.equal({
      errors: [
        { message: 'GraphQL middleware options must contain a schema.' }
      ]
    });
  });

});
