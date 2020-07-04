// @noflow

'use strict';

const fs = require('fs');

/**
 * Eliminates function call to `invariant` if the condition is met.
 *
 * Transforms:
 *
 *  loadFileStaticallyFromNPM(<npm path>)
 *
 * to:
 *
 *  "<file content>"
 */
module.exports = function inlineInvariant(context) {
  return {
    visitor: {
      CallExpression(path) {
        const { node } = path;

        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'loadFileStaticallyFromNPM'
        ) {
          const npmPath = node.arguments[0].value;
          const filePath = require.resolve(npmPath);
          const content = fs.readFileSync(filePath, 'utf-8');

          path.replaceWith(context.types.stringLiteral(content));
        }
      },
    },
  };
};
