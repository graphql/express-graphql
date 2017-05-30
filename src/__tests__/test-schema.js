/* @flow */
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

import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLNonNull,
  GraphQLString,
} from 'graphql';

const QueryRootType = new GraphQLObjectType({
  name: 'QueryRoot',
  fields: {
    test: {
      type: GraphQLString,
      args: {
        who: {
          type: GraphQLString,
        },
      },
      resolve: (root, { who }) => 'Hello ' + ((who: any) || 'World'),
    },
    nonNullThrower: {
      type: new GraphQLNonNull(GraphQLString),
      resolve: () => {
        throw new Error('Throws!');
      },
    },
    thrower: {
      type: GraphQLString,
      resolve: () => {
        throw new Error('Throws!');
      },
    },
    context: {
      type: GraphQLString,
      resolve: (obj, args, context) => context,
    },
    contextDotFoo: {
      type: GraphQLString,
      resolve: (obj, args, context) => {
        return (context: any).foo;
      },
    },
  },
});

const TestSchema = new GraphQLSchema({
  query: QueryRootType,
  mutation: new GraphQLObjectType({
    name: 'MutationRoot',
    fields: {
      writeTest: {
        type: QueryRootType,
        resolve: () => ({}),
      },
    },
  }),
});

// A simple schema which includes a mutation.
const UploadedFileType = new GraphQLObjectType({
  name: 'UploadedFile',
  fields: {
    originalname: { type: GraphQLString },
    mimetype: { type: GraphQLString },
  },
});

const TestMutationSchema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: 'QueryRoot',
    fields: {
      test: { type: GraphQLString },
    },
  }),
  mutation: new GraphQLObjectType({
    name: 'MutationRoot',
    fields: {
      uploadFile: {
        type: UploadedFileType,
        resolve(rootValue) {
          // For this test demo, we're just returning the uploaded
          // file directly, but presumably you might return a Promise
          // to go store the file somewhere first.
          return rootValue.request.file;
        },
      },
    },
  }),
});

module.exports = {
  TestMutationSchema,
  TestSchema,
};
