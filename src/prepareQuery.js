/* @flow */

import {
  GraphQLSchema,
  Document,
  Source,
  parse,
  validate
} from 'graphql';

type CacheEntry = {
  schema: GraphQLSchema,
  documentAST: Document,
}

const queryCache: Map<string, CacheEntry> = new Map();

// Set the query cache as a property of the module’s function.
prepareQuery.cache = queryCache;

/**
 * Prepares a GraphQL query to be used later.
 */
export function prepareQuery(
  query: string,
  schema: GraphQLSchema
): Document {
  // If the query exists in the cache, return it.
  if (queryCache.has(query)) {
    // These values will always exist (because we checked with `has`),
    // therefore the default object is ok.
    const { schema: cachedSchema, documentAST } = queryCache.get(query) || {};

    // We don’t support changing the schema when preparing a query.
    if (cachedSchema !== schema) {
      throw new Error('Can’t prepare a query with a different schemas.');
    }

    return documentAST;
  }

  const source = new Source(query, 'GraphQL Prepared Query');
  const documentAST = parse(source);
  const validationErrors = validate(schema, documentAST);

  // If validation failed…
  if (validationErrors.length > 0) {
    /* eslint-disable no-console */
    // Log all of our validation errors.
    validationErrors.map(error => console.error(error.stack));
    /* eslint-enable no-console */
    // Actually throw an error to stop execution.
    throw new Error('Failed to validate GraphQL query.');
  }

  // Add the query to the cache. We give the cache our `schema` so we can throw
  // an error if it changes.
  queryCache.set(query, { schema, documentAST });

  return documentAST;
}
