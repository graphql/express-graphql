/* @flow */
/**
 *  Copyright (c) 2015, Facebook, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 */

import {
  Source,
  parse,
  validate,
  execute,
  formatError,
  getOperationAST,
  specifiedRules
} from 'graphql';
import httpError from 'http-errors';

import { parseBody } from './parseBody';
import { renderGraphiQL } from './renderGraphiQL';

import type { Request, Response } from 'express';


/**
 * Used to configure the graphQLHTTP middleware by providing a schema
 * and other configuration options.
 *
 * Options can be provided as an Object, a Promise for an Object, or a Function
 * that returns an Object or a Promise for an Object.
 */
export type Options = ((request: Request) => OptionsResult) | OptionsResult;
export type OptionsResult = OptionsData | Promise<OptionsData>;
export type OptionsData = {
  /**
   * A GraphQL schema from graphql-js.
   */
  schema: Object,

  /**
   * A value to pass as the context to the graphql() function.
   */
  context?: ?mixed,

  /**
   * An object to pass as the rootValue to the graphql() function.
   */
  rootValue?: ?Object,

  /**
   * A boolean to configure whether the output should be pretty-printed.
   */
  pretty?: ?boolean,

  /**
   * An optional function which will be used to format any errors produced by
   * fulfilling a GraphQL operation. If no function is provided, GraphQL's
   * default spec-compliant `formatError` function will be used.
   */
  formatError?: ?Function,

  /**
   * An optional array of validation rules that will be applied on the document
   * in additional to those defined by the GraphQL spec.
   */
  validationRules?: ?Array<any>,

  /**
   * A boolean to optionally enable GraphiQL mode.
   */
  graphiql?: ?boolean,
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
    // Higher scoped variables are referred to at various stages in the
    // asyncronous state machine below.
    let schema;
    let context;
    let rootValue;
    let pretty;
    let graphiql;
    let formatErrorFn;
    let showGraphiQL;
    let query;
    let variables;
    let operationName;
    let validationRules;

    // Promises are used as a mechanism for capturing any thrown errors during
    // the asyncronous process below.

    // Resolve the Options to get OptionsData.
    new Promise(resolve => {
      resolve(typeof options === 'function' ? options(request) : options);
    }).then(optionsData => {
      // Assert that optionsData is in fact an Object.
      if (!optionsData || typeof optionsData !== 'object') {
        throw new Error(
          'GraphQL middleware option function must return an options object ' +
          'or a promise which will be resolved to an options object.'
        );
      }

      // Assert that schema is required.
      if (!optionsData.schema) {
        throw new Error(
          'GraphQL middleware options must contain a schema.'
        );
      }

      // Collect information from the options data object.
      schema = optionsData.schema;
      context = optionsData.context;
      rootValue = optionsData.rootValue;
      pretty = optionsData.pretty;
      graphiql = optionsData.graphiql;
      formatErrorFn = optionsData.formatError;

      validationRules = specifiedRules;
      if (optionsData.validationRules) {
        validationRules = validationRules.concat(optionsData.validationRules);
      }

      // GraphQL HTTP only supports GET and POST methods.
      if (request.method !== 'GET' && request.method !== 'POST') {
        response.set('Allow', 'GET, POST');
        throw httpError(405, 'GraphQL only supports GET and POST requests.');
      }

      // Parse the Request body.
      return parseBody(request);
    }).then(data => {
      showGraphiQL = graphiql && canDisplayGraphiQL(request, data);

      // Get GraphQL params from the request and POST body data.
      const params = getGraphQLParams(request, data);
      query = params.query;
      variables = params.variables;
      operationName = params.operationName;

      // If there is no query, but GraphiQL will be displayed, do not produce
      // a result, otherwise return a 400: Bad Request.
      if (!query) {
        if (showGraphiQL) {
          return null;
        }
        throw httpError(400, 'Must provide query string.');
      }

      // GraphQL source.
      const source = new Source(query, 'GraphQL request');

      // Parse source to AST, reporting any syntax error.
      let documentAST;
      try {
        documentAST = parse(source);
      } catch (syntaxError) {
        // Return 400: Bad Request if any syntax errors errors exist.
        response.status(400);
        return { errors: [ syntaxError ] };
      }

      // Validate AST, reporting any errors.
      const validationErrors = validate(schema, documentAST, validationRules);
      if (validationErrors.length > 0) {
        // Return 400: Bad Request if any validation errors exist.
        response.status(400);
        return { errors: validationErrors };
      }

      // Only query operations are allowed on GET requests.
      if (request.method === 'GET') {
        // Determine if this GET request will perform a non-query.
        const operationAST = getOperationAST(documentAST, operationName);
        if (operationAST && operationAST.operation !== 'query') {
          // If GraphiQL can be shown, do not perform this query, but
          // provide it to GraphiQL so that the requester may perform it
          // themselves if desired.
          if (showGraphiQL) {
            return null;
          }

          // Otherwise, report a 405: Method Not Allowed error.
          response.set('Allow', 'POST');
          throw httpError(
            405,
            `Can only perform a ${operationAST.operation} operation ` +
            'from a POST request.'
          );
        }
      }
      // Perform the execution, reporting any errors creating the context.
      try {
        return execute(
          schema,
          documentAST,
          rootValue,
          context,
          variables,
          operationName
        );
      } catch (contextError) {
        // Return 400: Bad Request if any execution context errors exist.
        response.statusCode = 400;
        return { errors: [ contextError ] };
      }
    }).catch(error => {
      // If an error was caught, report the httpError status, or 500.
      response.statusCode = error.status || 500;
      return { errors: [ error ] };
    }).then(result => {
      // Format any encountered errors.
      if (result && result.errors) {
        result.errors = result.errors.map(formatErrorFn || formatError);
      }

      // If allowed to show GraphiQL, present it instead of JSON.
      if (showGraphiQL) {
        response
          .set('Content-Type', 'text/html')
          .send(renderGraphiQL({ query, variables, operationName, result }));
      } else {
        // Otherwise, present JSON directly.
        response
          .set('Content-Type', 'application/json')
          .send(JSON.stringify(result, null, pretty ? 2 : 0));
      }
    });
  };
}

type GraphQLParams = {
  query: ?string;
  variables: ?Object;
  operationName: ?string;
}

/**
 * Helper function to get the GraphQL params from the request.
 */
function getGraphQLParams(request: Request, data: Object): GraphQLParams {
  // GraphQL Query string.
  const query = request.query.query || data.query;

  // Parse the variables if needed.
  let variables = request.query.variables || data.variables;
  if (variables && typeof variables === 'string') {
    try {
      variables = JSON.parse(variables);
    } catch (error) {
      throw httpError(400, 'Variables are invalid JSON.');
    }
  }

  // Name of GraphQL operation to execute.
  const operationName = request.query.operationName || data.operationName;

  return { query, variables, operationName };
}

/**
 * Helper function to determine if GraphiQL can be displayed.
 */
function canDisplayGraphiQL(request: Request, data: Object): boolean {
  // If `raw` exists, GraphiQL mode is not enabled.
  const raw = request.query.raw !== undefined || data.raw !== undefined;
  // Allowed to show GraphiQL if not requested as raw and this request
  // prefers HTML over JSON.
  return !raw && request.accepts([ 'json', 'html' ]) === 'html';
}
