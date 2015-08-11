/* @flow */
/**
 *  Copyright (c) 2015, Facebook, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 */

import httpError from 'http-errors';
import { graphql } from 'graphql';
import { formatError } from 'graphql/error';
import { parseBody } from './parseBody';
import type { Request, Response } from 'express';

/**
 * Used to configure the graphQLHTTP middleware by providing a schema
 * and other configuration options.
 */
export type Options = ((req: Request) => OptionsObj) | OptionsObj
export type OptionsObj = {
  /**
   * A GraphQL schema from graphql-js.
   */
  schema: Object,

  /**
   * An object to pass as the rootValue to the graphql() function.
   */
  rootValue?: ?Object,

  /**
   * A boolean to configure whether the output should be pretty-printed.
   */
  pretty?: ?boolean,
};

type Middleware = (request: Request, response: Response) => void;

/**
 * Middleware for express; takes an options object or function as input to
 * configure behavior, and returns an express middleware.
 */
export default function graphqlHTTP(options: Options): Middleware {
  if (!options) {
    throw new Error('GraphQL middleware requires options.');
  }

  return (request: Request, response: Response) => {

    // GraphQL HTTP only supports GET and POST methods.
    if (request.method !== 'GET' && request.method !== 'POST') {
      return response.status(405).set('Allow', 'GET, POST');
    }

    // Get GraphQL options given this request.
    var { schema, rootValue, pretty } = getOptions(options, request);

    // Parse the Request body.
    parseBody(request, (error, data) => {

      // Format any request errors the same as GraphQL errors.
      if (error) {
        var errorResponse = { errors: [ formatError(error) ] };
        return response
          .status(error.status || 500)
          .set('Content-Type', 'text/json')
          .send(JSON.stringify(errorResponse, null, pretty ? 2 : 0));
      }

      // Get GraphQL params from the request and POST body data.
      var {
        query,
        variables,
        operationName
      } = getGraphQLParams(request, data || {});

      // Run GraphQL query.
      graphql(
        schema,
        query,
        rootValue,
        variables,
        operationName
      ).then(result => {

        // Format any encountered errors.
        if (result.errors) {
          result.errors = result.errors.map(formatError);
        }

        // Report 200:Success if a data key exists,
        // Otherwise 400:BadRequest if only errors exist.
        response
          .status(result.hasOwnProperty('data') ? 200 : 400)
          .set('Content-Type', 'text/json')
          .send(JSON.stringify(result, null, pretty ? 2 : 0));
      });
    });
  };
}

/**
 * Get the options that the middleware was configured with, sanity
 * checking them.
 */
function getOptions(options: Options, request: Request): OptionsObj {
  var optionsData = typeof options === 'function' ? options(request) : options;

  if (!optionsData || typeof optionsData !== 'object') {
    throw new Error(
      'GraphQL middleware option function must return an options object.'
    );
  }

  if (!optionsData.schema) {
    throw new Error(
      'GraphQL middleware options must contain a schema.'
    );
  }

  return optionsData;
}

type GraphQLParams = {
  query: string;
  variables: ?Object;
  operationName: ?string;
}

/**
 * Helper function to get the GraphQL params from the request.
 */
function getGraphQLParams(request: Request, data: Object): GraphQLParams {
  // GraphQL Query string.
  var query = request.query.query || data.query;
  if (!query) {
    throw httpError(400, 'Must provide query string.');
  }

  // Parse the variables if needed.
  var variables = request.query.variables || data.variables;
  if (variables && typeof variables === 'string') {
    try {
      variables = JSON.parse(variables);
    } catch (error) {
      throw httpError(400, 'Variables are invalid JSON.');
    }
  }

  // Name of GraphQL operation to execute.
  var operationName = request.query.operationName || data.operationName;

  return { query, variables, operationName };
}
