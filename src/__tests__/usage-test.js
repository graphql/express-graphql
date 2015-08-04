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
import { stringify } from 'querystring';
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

    var error;
    app.use('/graphql', graphqlHTTP(() => null));
    app.use(function (err, req, res, next) {
      // Omitting next causes issues, but it can't be an unused var either
      expect(next).to.not.equal(null);
      error = err;
      res.status(200).send();
    });

    await request(app).get('/graphql?' + stringify({ query: '{test}' }));
    expect(error.message).to.equal(
      'GraphQL middleware option function must return an options object.'
    );
  });

  it('requires option factory function to return object with schema', async () => {
    var app = express();

    var error;
    app.use('/graphql', graphqlHTTP(() => ({})));
    app.use(function (err, req, res, next) {
      // Omitting next causes issues, but it can't be an unused var either
      expect(next).to.not.equal(null);
      error = err;
      res.status(200).send();
    });

    await request(app).get('/graphql?' + stringify({ query: '{test}' }));
    expect(error.message).to.equal(
      'GraphQL middleware options must contain a schema.'
    );
  });

});
