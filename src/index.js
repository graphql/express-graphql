// @flow strict

import url from 'url';
import { type IncomingMessage, type ServerResponse } from 'http';

import accepts from 'accepts';
import httpError from 'http-errors';
import {
  Source,
  parse,
  validate,
  execute,
  formatError,
  validateSchema,
  getOperationAST,
  specifiedRules,
  type ASTVisitor,
  type DocumentNode,
  type ValidationRule,
  type ValidationContext,
  type ExecutionArgs,
  type ExecutionResult,
  type GraphQLError,
  type GraphQLSchema,
  type GraphQLFieldResolver,
  type GraphQLTypeResolver,
} from 'graphql';

import { parseBody } from './parseBody';
import { renderGraphiQL, type GraphiQLOptions } from './renderGraphiQL';

type $Request = IncomingMessage;
type $Response = ServerResponse & {| json?: ?(data: mixed) => void |};

/**
 * Used to configure the graphqlHTTP middleware by providing a schema
 * and other configuration options.
 *
 * Options can be provided as an Object, a Promise for an Object, or a Function
 * that returns an Object or a Promise for an Object.
 */
export type Options =
  | ((
      request: $Request,
      response: $Response,
      params?: GraphQLParams,
    ) => OptionsResult)
  | OptionsResult;
export type OptionsResult = OptionsData | Promise<OptionsData>;

export type OptionsData = {|
  /**
   * A GraphQL schema from graphql-js.
   */
  schema: GraphQLSchema,

  /**
   * A value to pass as the context to this middleware.
   */
  context?: ?mixed,

  /**
   * An object to pass as the rootValue to the graphql() function.
   */
  rootValue?: ?mixed,

  /**
   * A boolean to configure whether the output should be pretty-printed.
   */
  pretty?: ?boolean,

  /**
   * An optional array of validation rules that will be applied on the document
   * in additional to those defined by the GraphQL spec.
   */
  validationRules?: ?$ReadOnlyArray<(ValidationContext) => ASTVisitor>,

  /**
   * An optional function which will be used to validate instead of default `validate`
   * from `graphql-js`.
   */
  customValidateFn?: ?(
    schema: GraphQLSchema,
    documentAST: DocumentNode,
    rules: $ReadOnlyArray<ValidationRule>,
  ) => $ReadOnlyArray<GraphQLError>,

  /**
   * An optional function which will be used to execute instead of default `execute`
   * from `graphql-js`.
   */
  customExecuteFn?: ?(
    args: ExecutionArgs,
  ) => ExecutionResult | Promise<ExecutionResult>,

  /**
   * An optional function which will be used to format any errors produced by
   * fulfilling a GraphQL operation. If no function is provided, GraphQL's
   * default spec-compliant `formatError` function will be used.
   */
  customFormatErrorFn?: ?(error: GraphQLError) => mixed,

  /**
   * An optional function which will be used to create a document instead of
   * the default `parse` from `graphql-js`.
   */
  customParseFn?: ?(source: Source) => DocumentNode,

  /**
   * `formatError` is deprecated and replaced by `customFormatErrorFn`. It will
   *  be removed in version 1.0.0.
   */
  formatError?: ?(error: GraphQLError) => mixed,

  /**
   * An optional function for adding additional metadata to the GraphQL response
   * as a key-value object. The result will be added to "extensions" field in
   * the resulting JSON. This is often a useful place to add development time
   * info such as the runtime of a query or the amount of resources consumed.
   *
   * Information about the request is provided to be used.
   *
   * This function may be async.
   */
  extensions?: ?(info: RequestInfo) => { [key: string]: mixed, ... },

  /**
   * A boolean to optionally enable GraphiQL mode.
   * Alternatively, instead of `true` you can pass in an options object.
   */
  graphiql?: ?boolean | ?GraphiQLOptions,

  /**
   * A resolver function to use when one is not provided by the schema.
   * If not provided, the default field resolver is used (which looks for a
   * value or method on the source value with the field's name).
   */
  fieldResolver?: ?GraphQLFieldResolver<mixed, mixed>,

  /**
   * A type resolver function to use when none is provided by the schema.
   * If not provided, the default type resolver is used (which looks for a
   * `__typename` field or alternatively calls the `isTypeOf` method).
   */
  typeResolver?: ?GraphQLTypeResolver<mixed, mixed>,
|};

/**
 * All information about a GraphQL request.
 */
export type RequestInfo = {|
  /**
   * The parsed GraphQL document.
   */
  document: ?DocumentNode,

  /**
   * The variable values used at runtime.
   */
  variables: ?{ +[name: string]: mixed, ... },

  /**
   * The (optional) operation name requested.
   */
  operationName: ?string,

  /**
   * The result of executing the operation.
   */
  result: ?ExecutionResult,

  /**
   * A value to pass as the context to the graphql() function.
   */
  context?: ?mixed,
|};

type Middleware = (request: $Request, response: $Response) => Promise<void>;

/**
 * Middleware for express; takes an options object or function as input to
 * configure behavior, and returns an express middleware.
 */
module.exports = graphqlHTTP;
function graphqlHTTP(options: Options): Middleware {
  if (!options) {
    throw new Error('GraphQL middleware requires options.');
  }

  return async function graphqlMiddleware(
    request: $Request,
    response: $Response,
  ) {
    // Higher scoped variables are referred to at various stages in the
    // asynchronous state machine below.
    let params;
    let showGraphiQL = false;
    let graphiqlOptions;
    let result: ExecutionResult;
    let optionsData;

    try {
      // Parse the Request to get GraphQL request parameters.
      try {
        params = await getGraphQLParams(request);
      } catch (error) {
        // When we failed to parse the GraphQL parameters, we still need to get
        // the options object, so make an options call to resolve just that.
        optionsData = await resolveOptions();
        throw error;
      }

      // Then, resolve the Options to get OptionsData.
      optionsData = await resolveOptions(params);

      // Collect information from the options data object.
      const schema = optionsData.schema;
      const rootValue = optionsData.rootValue;
      const validationRules = optionsData.validationRules ?? [];
      const fieldResolver = optionsData.fieldResolver;
      const typeResolver = optionsData.typeResolver;
      const graphiql = optionsData.graphiql ?? false;
      const extensionsFn = optionsData.extensions;
      const context = optionsData.context ?? request;
      const parseFn = optionsData.customParseFn ?? parse;
      const executeFn = optionsData.customExecuteFn ?? execute;
      const validateFn = optionsData.customValidateFn ?? validate;

      // Assert that schema is required.
      if (schema == null) {
        throw httpError(
          500,
          'GraphQL middleware options must contain a schema.',
        );
      }

      // GraphQL HTTP only supports GET and POST methods.
      if (request.method !== 'GET' && request.method !== 'POST') {
        throw httpError(405, 'GraphQL only supports GET and POST requests.', {
          headers: { Allow: 'GET, POST' },
        });
      }

      // Get GraphQL params from the request and POST body data.
      const { query, variables, operationName } = params;
      showGraphiQL = canDisplayGraphiQL(request, params) && graphiql;
      if (typeof graphiql !== 'boolean') {
        graphiqlOptions = graphiql;
      }

      // If there is no query, but GraphiQL will be displayed, do not produce
      // a result, otherwise return a 400: Bad Request.
      if (query == null) {
        if (showGraphiQL) {
          return respondWithGraphiQL(response, graphiqlOptions);
        }
        throw httpError(400, 'Must provide query string.');
      }

      // Validate Schema
      const schemaValidationErrors = validateSchema(schema);
      if (schemaValidationErrors.length > 0) {
        // Return 500: Internal Server Error if invalid schema.
        throw httpError(500, 'GraphQL schema validation error.', {
          graphqlErrors: schemaValidationErrors,
        });
      }

      // Parse source to AST, reporting any syntax error.
      let documentAST;
      try {
        documentAST = parseFn(new Source(query, 'GraphQL request'));
      } catch (syntaxError) {
        // Return 400: Bad Request if any syntax errors errors exist.
        throw httpError(400, 'GraphQL syntax error.', {
          graphqlErrors: [syntaxError],
        });
      }

      // Validate AST, reporting any errors.
      const validationErrors = validateFn(schema, documentAST, [
        ...specifiedRules,
        ...validationRules,
      ]);

      if (validationErrors.length > 0) {
        // Return 400: Bad Request if any validation errors exist.
        throw httpError(400, 'GraphQL validation error.', {
          graphqlErrors: validationErrors,
        });
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
            return respondWithGraphiQL(response, graphiqlOptions, params);
          }

          // Otherwise, report a 405: Method Not Allowed error.
          throw httpError(
            405,
            `Can only perform a ${operationAST.operation} operation from a POST request.`,
            { headers: { Allow: 'POST' } },
          );
        }
      }

      // Perform the execution, reporting any errors creating the context.
      try {
        result = await executeFn({
          schema,
          document: documentAST,
          rootValue,
          contextValue: context,
          variableValues: variables,
          operationName,
          fieldResolver,
          typeResolver,
        });
      } catch (contextError) {
        // Return 400: Bad Request if any execution context errors exist.
        throw httpError(400, 'GraphQL execution context error.', {
          graphqlErrors: [contextError],
        });
      }

      // Collect and apply any metadata extensions if a function was provided.
      // https://graphql.github.io/graphql-spec/#sec-Response-Format
      if (extensionsFn) {
        const extensionsObj = await extensionsFn({
          document: documentAST,
          variables,
          operationName,
          result,
          context,
        });

        if (extensionsObj != null && typeof extensionsObj === 'object') {
          (result: any).extensions = extensionsObj;
        }
      }
    } catch (error) {
      // If an error was caught, report the httpError status, or 500.
      response.statusCode = error.status ?? 500;

      if (error.headers != null) {
        for (const [key, value] of Object.entries(error.headers)) {
          (response: any).setHeader(key, value);
        }
      }

      result = { errors: error.graphqlErrors ?? [error] };
    }

    // If no data was included in the result, that indicates a runtime query
    // error, indicate as such with a generic status code.
    // Note: Information about the error itself will still be contained in
    // the resulting JSON payload.
    // https://graphql.github.io/graphql-spec/#sec-Data
    if (response.statusCode === 200 && result.data == null) {
      response.statusCode = 500;
    }

    // Format any encountered errors.
    if (result.errors) {
      const formatErrorFn =
        optionsData?.customFormatErrorFn ??
        optionsData?.formatError ??
        formatError;
      (result: any).errors = result.errors.map(formatErrorFn);
    }

    // If allowed to show GraphiQL, present it instead of JSON.
    if (showGraphiQL) {
      return respondWithGraphiQL(response, graphiqlOptions, params, result);
    }

    // If "pretty" JSON isn't requested, and the server provides a
    // response.json method (express), use that directly.
    // Otherwise use the simplified sendResponse method.
    const pretty = optionsData?.pretty || false;
    if (!pretty && typeof response.json === 'function') {
      response.json(result);
    } else {
      const payload = JSON.stringify(result, null, pretty ? 2 : 0);
      sendResponse(response, 'application/json', payload);
    }

    async function resolveOptions(
      requestParams?: GraphQLParams,
    ): Promise<OptionsData> {
      const optionsResult = await (typeof options === 'function'
        ? options(request, response, requestParams)
        : options);

      // Assert that optionsData is in fact an Object.
      if (optionsResult == null || typeof optionsResult !== 'object') {
        throw new Error(
          'GraphQL middleware option function must return an options object or a promise which will be resolved to an options object.',
        );
      }

      if (optionsResult.formatError) {
        // eslint-disable-next-line no-console
        console.warn(
          '`formatError` is deprecated and replaced by `customFormatErrorFn`. It will be removed in version 1.0.0.',
        );
      }

      return optionsResult;
    }
  };
}

function respondWithGraphiQL(
  response: $Response,
  options: ?GraphiQLOptions,
  params?: GraphQLParams,
  result?: ExecutionResult,
): void {
  const payload = renderGraphiQL({
    query: params?.query,
    variables: params?.variables,
    operationName: params?.operationName,
    result,
    options,
  });
  return sendResponse(response, 'text/html', payload);
}

export type GraphQLParams = {|
  query: string | null,
  variables: { +[name: string]: mixed, ... } | null,
  operationName: string | null,
  raw: boolean,
|};

/**
 * Provided a "Request" provided by express or connect (typically a node style
 * HTTPClientRequest), Promise the GraphQL request parameters.
 */
module.exports.getGraphQLParams = getGraphQLParams;
async function getGraphQLParams(request: $Request): Promise<GraphQLParams> {
  const bodyData = await parseBody(request);
  const urlData =
    (request.url != null && url.parse(request.url, true).query) || {};

  return parseGraphQLParams(urlData, bodyData);
}

/**
 * Helper function to get the GraphQL params from the request.
 */
function parseGraphQLParams(
  urlData: { [param: string]: string, ... },
  bodyData: { [param: string]: mixed, ... },
): GraphQLParams {
  // GraphQL Query string.
  let query = urlData.query ?? bodyData.query;
  if (typeof query !== 'string') {
    query = null;
  }

  // Parse the variables if needed.
  let variables = urlData.variables ?? bodyData.variables;
  if (typeof variables === 'string') {
    try {
      variables = JSON.parse(variables);
    } catch (error) {
      throw httpError(400, 'Variables are invalid JSON.');
    }
  } else if (typeof variables !== 'object') {
    variables = null;
  }

  // Name of GraphQL operation to execute.
  let operationName = urlData.operationName || bodyData.operationName;
  if (typeof operationName !== 'string') {
    operationName = null;
  }

  const raw = urlData.raw !== undefined || bodyData.raw !== undefined;

  return { query, variables, operationName, raw };
}

/**
 * Helper function to determine if GraphiQL can be displayed.
 */
function canDisplayGraphiQL(request: $Request, params: GraphQLParams): boolean {
  // If `raw` false, GraphiQL mode is not enabled.
  // Allowed to show GraphiQL if not requested as raw and this request prefers HTML over JSON.
  return !params.raw && accepts(request).types(['json', 'html']) === 'html';
}

/**
 * Helper function for sending a response using only the core Node server APIs.
 */
function sendResponse(response: $Response, type: string, data: string): void {
  const chunk = Buffer.from(data, 'utf8');
  response.setHeader('Content-Type', type + '; charset=utf-8');
  response.setHeader('Content-Length', String(chunk.length));
  response.end(chunk);
}
