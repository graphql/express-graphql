/**
 *  Copyright (c) 2015, Facebook, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';
import { introspectionQuery, parse, validate } from 'graphql';
import { TestSchema } from './test-schema';
import { DisableIntrospectionQueries } from '../disable-introspection';

function expectPassesRule(rules, queryString) {
  const errors = validate(TestSchema, parse(queryString), rules);
  expect(errors).to.deep.equal([], 'Should validate');
}

function expectFailsRule(rules, queryString) {
  const errors = validate(TestSchema, parse(queryString), rules);
  expect(errors).to.have.length.of.at.least(1, 'Should not validate');
}

describe('Validate: Query does not contain Introspection', () => {
  it('valid scalar selection', () => {
    expectPassesRule(
      [DisableIntrospectionQueries],
      `
      query helloWho($who: String){ test(who: "Steve Buscemi") }
      `,
    );
  });
  it('invalid introspection', () => {
    expectFailsRule([DisableIntrospectionQueries], introspectionQuery);
  });
});
