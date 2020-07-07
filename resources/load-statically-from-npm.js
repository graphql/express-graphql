'use strict';

const fs = require('fs');

const ts = require('typescript');

/**
 * Transforms:
 *
 *  loadFileStaticallyFromNPM(<npm path>)
 *
 * to:
 *
 *  "<file content>"
 */
module.exports.transformLoadFileStaticallyFromNPM = function (context) {
  return function visit(node) {
    if (ts.isCallExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'loadFileStaticallyFromNPM'
      ) {
        const npmPath = node.arguments[0].text;
        const filePath = require.resolve(npmPath);
        const content = fs.readFileSync(filePath, 'utf-8');
        return ts.createStringLiteral(content);
      }
    }
    return ts.visitEachChild(node, visit, context);
  };
};
