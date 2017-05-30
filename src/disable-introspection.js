/* @flow */

import { GraphQLError } from 'graphql';

import type { ValidationContext, GraphQLType, FieldNode } from 'graphql';

const INTROSPECTION_TYPES = ['__Schema!', '__Type!'];

export function noIntrospectionAllowedMessage(
  fieldName: string,
  type: GraphQLType,
): string {
  return (
    'Introspection has been disabled for this schema. The field ' +
    `"${fieldName}" of type "${String(type)}" is not allowed.`
  );
}

/**
 * Disable Introspection Queries
 *
 * A GraphQL document is valid only if it contains no introspection types.
 */
export function DisableIntrospectionQueries(context: ValidationContext): any {
  return {
    Field(node: FieldNode) {
      const type = context.getType();
      if (type) {
        if (INTROSPECTION_TYPES.indexOf(String(type)) >= 0) {
          context.reportError(
            new GraphQLError(
              noIntrospectionAllowedMessage(node.name.value, type),
            ),
          );
        }
      }
    },
  };
}
