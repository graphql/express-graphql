import type { IncomingMessage } from 'http';
import { ServerResponse } from 'http';

import type {
  ASTVisitor,
  DocumentNode,
  ValidationRule,
  ValidationContext,
  ExecutionArgs,
  ExecutionResult,
  FormattedExecutionResult,
  ExecutionPatchResult,
  FormattedExecutionPatchResult,
  AsyncExecutionResult,
  GraphQLSchema,
  GraphQLFieldResolver,
  GraphQLTypeResolver,
  GraphQLFormattedError,
} from 'graphql';
import accepts from 'accepts';
import httpError from 'http-errors';
import type { HttpError } from 'http-errors';
import {
  Source,
  GraphQLError,
  parse,
  validate,
  execute,
  formatError,
  validateSchema,
  getOperationAST,
  specifiedRules,
} from 'graphql';

import type { GraphiQLOptions, GraphiQLData } from './renderGraphiQL';
import { parseBody } from './parseBody';
import { isAsyncIterable } from './isAsyncIterable';
import { renderGraphiQL } from './renderGraphiQL';

// `url` is always defined for IncomingMessage coming from http.Server
type Request = IncomingMessage & { url: string };

type Response = ServerResponse & {
  json?: (data: unknown) => void;
  flush?: () => void;
};
type MaybePromise<T> = Promise<T> | T;

/**
 * Used to configure the graphqlHTTP middleware by providing a schema
 * and other configuration options.
 *
 * Options can be provided as an Object, a Promise for an Object, or a Function
 * that returns an Object or a Promise for an Object.
 */
export type Options =
  | ((
      request: Request,
      response: Response,
      params?: GraphQLParams,
    ) => MaybePromise<OptionsData>)
  | MaybePromise<OptionsData>;

export interface OptionsData {
  /**
   * A GraphQL schema from graphql-js.
   */
  schema: GraphQLSchema;

  /**
   * A value to pass as the context to this middleware.
   */
  context?: unknown;

  /**
   * An object to pass as the rootValue to the graphql() function.
   */
  rootValue?: unknown;

  /**
   * A boolean to configure whether the output should be pretty-printed.
   */
  pretty?: boolean;

  /**
   * An optional array of validation rules that will be applied on the document
   * in additional to those defined by the GraphQL spec.
   */
  validationRules?: ReadonlyArray<(ctx: ValidationContext) => ASTVisitor>;

  /**
   * An optional function which will be used to validate instead of default `validate`
   * from `graphql-js`.
   */
  customValidateFn?: (
    schema: GraphQLSchema,
    documentAST: DocumentNode,
    rules: ReadonlyArray<ValidationRule>,
  ) => ReadonlyArray<GraphQLError>;

  /**
   * An optional function which will be used to execute instead of default `execute`
   * from `graphql-js`.
   */
  customExecuteFn?: (
    args: ExecutionArgs,
  ) => MaybePromise<ExecutionResult | AsyncIterable<AsyncExecutionResult>>;

  /**
   * An optional function which will be used to format any errors produced by
   * fulfilling a GraphQL operation. If no function is provided, GraphQL's
   * default spec-compliant `formatError` function will be used.
   */
  customFormatErrorFn?: (error: GraphQLError) => GraphQLFormattedError;

  /**
   * An optional function which will be used to create a document instead of
   * the default `parse` from `graphql-js`.
   */
  customParseFn?: (source: Source) => DocumentNode;

  /**
   * `formatError` is deprecated and replaced by `customFormatErrorFn`. It will
   *  be removed in version 1.0.0.
   */
  formatError?: (error: GraphQLError) => GraphQLFormattedError;

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
  extensions?: (
    info: RequestInfo,
  ) => MaybePromise<undefined | { [key: string]: unknown }>;

  /**
   * A boolean to optionally enable GraphiQL mode.
   * Alternatively, instead of `true` you can pass in an options object.
   */
  graphiql?: boolean | GraphiQLOptions;

  /**
   * A resolver function to use when one is not provided by the schema.
   * If not provided, the default field resolver is used (which looks for a
   * value or method on the source value with the field's name).
   */
  fieldResolver?: GraphQLFieldResolver<unknown, unknown>;

  /**
   * A type resolver function to use when none is provided by the schema.
   * If not provided, the default type resolver is used (which looks for a
   * `__typename` field or alternatively calls the `isTypeOf` method).
   */
  typeResolver?: GraphQLTypeResolver<unknown, unknown>;
}

/**
 * All information about a GraphQL request.
 */
export interface RequestInfo {
  /**
   * The parsed GraphQL document.
   */
  document: DocumentNode;

  /**
   * The variable values used at runtime.
   */
  variables: { readonly [name: string]: unknown } | null;

  /**
   * The (optional) operation name requested.
   */
  operationName: string | null;

  /**
   * The result of executing the operation.
   */
  result: AsyncExecutionResult;

  /**
   * A value to pass as the context to the graphql() function.
   */
  context?: unknown;
}

type Middleware = (request: Request, response: Response) => Promise<void>;

/**
 * Middleware for express; takes an options object or function as input to
 * configure behavior, and returns an express middleware.
 */
export function graphqlHTTP(options: Options): Middleware {
  devAssert(options != null, 'GraphQL middleware requires options.');

  return async function graphqlMiddleware(
    request: Request,
    response: Response,
  ): Promise<void> {
    // Higher scoped variables are referred to at various stages in the asynchronous state machine below.
    let params: GraphQLParams | undefined;
    let showGraphiQL = false;
    let graphiqlOptions;
    let formatErrorFn = formatError;
    let extensionsFn;
    let pretty = false;
    let documentAST: DocumentNode;
    let executeResult;
    let result: ExecutionResult;
    let finishedIterable = false;

    try {
      // Parse the Request to get GraphQL request parameters.
      try {
        params = await getGraphQLParams(request);
      } catch (error: unknown) {
        // When we failed to parse the GraphQL parameters, we still need to get
        // the options object, so make an options call to resolve just that.
        const optionsData = await resolveOptions();
        pretty = optionsData.pretty ?? false;
        formatErrorFn =
          optionsData.customFormatErrorFn ??
          optionsData.formatError ??
          formatErrorFn;
        throw error;
      }

      // Then, resolve the Options to get OptionsData.
      const optionsData: OptionsData = await resolveOptions(params);

      // Collect information from the options data object.
      const schema = optionsData.schema;
      const rootValue = optionsData.rootValue;
      const validationRules = optionsData.validationRules ?? [];
      const fieldResolver = optionsData.fieldResolver;
      const typeResolver = optionsData.typeResolver;
      const graphiql = optionsData.graphiql ?? false;
      const context = optionsData.context ?? request;
      const parseFn = optionsData.customParseFn ?? parse;
      const executeFn = optionsData.customExecuteFn ?? execute;
      const validateFn = optionsData.customValidateFn ?? validate;

      pretty = optionsData.pretty ?? false;
      formatErrorFn =
        optionsData.customFormatErrorFn ??
        optionsData.formatError ??
        formatErrorFn;

      // Assert that schema is required.
      devAssert(
        schema != null,
        'GraphQL middleware options must contain a schema.',
      );

      // GraphQL HTTP only supports GET and POST methods.
      if (request.method !== 'GET' && request.method !== 'POST') {
        throw httpError(405, 'GraphQL only supports GET and POST requests.', {
          headers: { Allow: 'GET, POST' },
        });
      }

      // Get GraphQL params from the request and POST body data.
      const { query, variables, operationName } = params;
      showGraphiQL = canDisplayGraphiQL(request, params) && graphiql !== false;
      if (typeof graphiql !== 'boolean') {
        graphiqlOptions = graphiql;
      }

      // Collect and apply any metadata extensions if a function was provided.
      // https://graphql.github.io/graphql-spec/#sec-Response-Format
      if (optionsData.extensions) {
        extensionsFn = (payload: AsyncExecutionResult) => {
          /* istanbul ignore else: condition not reachable, required for typescript */
          if (optionsData.extensions) {
            return optionsData.extensions({
              document: documentAST,
              variables,
              operationName,
              result: payload,
              context,
            });
          }
          /* istanbul ignore next: condition not reachable, required for typescript */
          return undefined;
        };
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
      try {
        documentAST = parseFn(new Source(query, 'GraphQL request'));
      } catch (syntaxError: unknown) {
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
        executeResult = await executeFn({
          schema,
          document: documentAST,
          rootValue,
          contextValue: context,
          variableValues: variables,
          operationName,
          fieldResolver,
          typeResolver,
        });

        if (isAsyncIterable(executeResult)) {
          // Get first payload from AsyncIterator. http status will reflect status
          // of this payload.
          const asyncIterator = getAsyncIterator<ExecutionResult>(
            executeResult,
          );

          response.on('close', () => {
            if (
              !finishedIterable &&
              typeof asyncIterator.return === 'function'
            ) {
              asyncIterator.return().then(null, (rawError: unknown) => {
                const graphqlError = getGraphQlError(rawError);
                sendPartialResponse(pretty, response, {
                  data: undefined,
                  errors: [formatErrorFn(graphqlError)],
                  hasNext: false,
                });
              });
            }
          });

          const { value } = await asyncIterator.next();
          result = value;
        } else {
          result = executeResult;
        }
      } catch (contextError: unknown) {
        // Return 400: Bad Request if any execution context errors exist.
        throw httpError(400, 'GraphQL execution context error.', {
          graphqlErrors: [contextError],
        });
      }

      if (extensionsFn) {
        const extensions = await extensionsFn(result);

        if (extensions != null) {
          result = { ...result, extensions };
        }
      }
    } catch (rawError: unknown) {
      // If an error was caught, report the httpError status, or 500.
      const error: HttpError = httpError(
        500,
        /* istanbul ignore next: Thrown by underlying library. */
        rawError instanceof Error ? rawError : String(rawError),
      );

      // eslint-disable-next-line require-atomic-updates
      response.statusCode = error.status;

      const { headers } = error;
      if (headers != null) {
        for (const [key, value] of Object.entries(headers)) {
          response.setHeader(key, String(value));
        }
      }

      if (error.graphqlErrors == null) {
        const graphqlError = new GraphQLError(
          error.message,
          undefined,
          undefined,
          undefined,
          undefined,
          error,
        );
        executeResult = result = { data: undefined, errors: [graphqlError] };
      } else {
        executeResult = result = {
          data: undefined,
          errors: error.graphqlErrors,
        };
      }
    }

    // If no data was included in the result, that indicates a runtime query
    // error, indicate as such with a generic status code.
    // Note: Information about the error itself will still be contained in
    // the resulting JSON payload.
    // https://graphql.github.io/graphql-spec/#sec-Data
    if (response.statusCode === 200 && result.data == null) {
      // eslint-disable-next-line require-atomic-updates
      response.statusCode = 500;
    }

    // Format any encountered errors.
    const formattedResult: FormattedExecutionResult = {
      ...result,
      errors: result.errors?.map(formatErrorFn),
    };

    if (isAsyncIterable(executeResult)) {
      response.setHeader('Content-Type', 'multipart/mixed; boundary="-"');
      sendPartialResponse(pretty, response, formattedResult);
      try {
        for await (let payload of executeResult) {
          // Collect and apply any metadata extensions if a function was provided.
          // https://graphql.github.io/graphql-spec/#sec-Response-Format
          if (extensionsFn) {
            const extensions = await extensionsFn(payload);

            if (extensions != null) {
              payload = { ...payload, extensions };
            }
          }
          const formattedPayload: FormattedExecutionPatchResult = {
            // first payload is already consumed, all subsequent payloads typed as ExecutionPatchResult
            ...(payload as ExecutionPatchResult),
            errors: payload.errors?.map(formatErrorFn),
          };
          sendPartialResponse(pretty, response, formattedPayload);
        }
      } catch (rawError: unknown) {
        const graphqlError = getGraphQlError(rawError);
        sendPartialResponse(pretty, response, {
          data: undefined,
          errors: [formatErrorFn(graphqlError)],
          hasNext: false,
        });
      }
      response.write('\r\n-----\r\n');
      response.end();
      finishedIterable = true;
      return;
    }

    // If allowed to show GraphiQL, present it instead of JSON.
    if (showGraphiQL) {
      return respondWithGraphiQL(
        response,
        graphiqlOptions,
        params,
        formattedResult,
      );
    }

    // If "pretty" JSON isn't requested, and the server provides a
    // response.json method (express), use that directly.
    // Otherwise use the simplified sendResponse method.
    if (!pretty && typeof response.json === 'function') {
      response.json(formattedResult);
    } else {
      const payload = JSON.stringify(formattedResult, null, pretty ? 2 : 0);
      sendResponse(response, 'application/json', payload);
    }

    async function resolveOptions(
      requestParams?: GraphQLParams,
    ): Promise<OptionsData> {
      const optionsResult = await Promise.resolve(
        typeof options === 'function'
          ? options(request, response, requestParams)
          : options,
      );

      devAssert(
        optionsResult != null && typeof optionsResult === 'object',
        'GraphQL middleware option function must return an options object or a promise which will be resolved to an options object.',
      );

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
  response: Response,
  options?: GraphiQLOptions,
  params?: GraphQLParams,
  result?: FormattedExecutionResult,
): void {
  const data: GraphiQLData = {
    query: params?.query,
    variables: params?.variables,
    operationName: params?.operationName,
    result,
  };
  const payload = renderGraphiQL(data, options);
  return sendResponse(response, 'text/html', payload);
}

export interface GraphQLParams {
  query: string | null;
  variables: { readonly [name: string]: unknown } | null;
  operationName: string | null;
  raw: boolean;
}

/**
 * Provided a "Request" provided by express or connect (typically a node style
 * HTTPClientRequest), Promise the GraphQL request parameters.
 */
export async function getGraphQLParams(
  request: Request,
): Promise<GraphQLParams> {
  const urlData = new URLSearchParams(request.url.split('?')[1]);
  const bodyData = await parseBody(request);

  // GraphQL Query string.
  let query = urlData.get('query') ?? (bodyData.query as string | null);
  if (typeof query !== 'string') {
    query = null;
  }

  // Parse the variables if needed.
  let variables = (urlData.get('variables') ?? bodyData.variables) as {
    readonly [name: string]: unknown;
  } | null;
  if (typeof variables === 'string') {
    try {
      variables = JSON.parse(variables);
    } catch {
      throw httpError(400, 'Variables are invalid JSON.');
    }
  } else if (typeof variables !== 'object') {
    variables = null;
  }

  // Name of GraphQL operation to execute.
  let operationName =
    urlData.get('operationName') ?? (bodyData.operationName as string | null);
  if (typeof operationName !== 'string') {
    operationName = null;
  }

  const raw = urlData.get('raw') != null || bodyData.raw !== undefined;

  return { query, variables, operationName, raw };
}

/**
 * Helper function to determine if GraphiQL can be displayed.
 */
function canDisplayGraphiQL(request: Request, params: GraphQLParams): boolean {
  // If `raw` false, GraphiQL mode is not enabled.
  // Allowed to show GraphiQL if not requested as raw and this request prefers HTML over JSON.
  return !params.raw && accepts(request).types(['json', 'html']) === 'html';
}

/**
 * Helper function for sending part of a multi-part response using only the core Node server APIs.
 */
function sendPartialResponse(
  pretty: boolean,
  response: Response,
  result: FormattedExecutionResult | FormattedExecutionPatchResult,
): void {
  const json = JSON.stringify(result, null, pretty ? 2 : 0);
  const chunk = Buffer.from(json, 'utf8');
  const data = [
    '',
    '---',
    'Content-Type: application/json; charset=utf-8',
    'Content-Length: ' + String(chunk.length),
    '',
    chunk,
    '',
  ].join('\r\n');
  response.write(data);
  // flush response if compression middleware is used
  if (
    typeof response.flush === 'function' &&
    // @ts-expect-error deprecated flush method is implemented on ServerResponse but not typed
    response.flush !== ServerResponse.prototype.flush
  ) {
    response.flush();
  }
}

/**
 * Helper function for sending a response using only the core Node server APIs.
 */
function sendResponse(response: Response, type: string, data: string): void {
  const chunk = Buffer.from(data, 'utf8');
  response.setHeader('Content-Type', type + '; charset=utf-8');
  response.setHeader('Content-Length', String(chunk.length));
  response.end(chunk);
}

function devAssert(condition: unknown, message: string): asserts condition {
  const booleanCondition = Boolean(condition);
  if (!booleanCondition) {
    throw new Error(message);
  }
}

function getAsyncIterator<T>(
  asyncIterable: AsyncIterable<T>,
): AsyncIterator<T> {
  const method = asyncIterable[Symbol.asyncIterator];
  return method.call(asyncIterable);
}

function getGraphQlError(rawError: unknown) {
  /* istanbul ignore next: Thrown by underlying library. */
  const error =
    rawError instanceof Error ? rawError : new Error(String(rawError));
  return new GraphQLError(
    error.message,
    undefined,
    undefined,
    undefined,
    undefined,
    error,
  );
}
