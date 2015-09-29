/* @flow */
/**
 *  Copyright (c) 2015, Facebook, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 */

import contentType from 'content-type';
import getBody from 'raw-body';
import httpError from 'http-errors';
import querystring from 'querystring';
import zlib from 'zlib';
import type { Request } from 'express';


export function parseBody(req: Request, next: NodeCallback): void {
  try {
    // If express has already parsed a body as an object, use it.
    if (typeof req.body === 'object') {
      return next(null, req.body);
    }

    // Skip requests without content types.
    if (req.headers['content-type'] === undefined) {
      return next();
    }

    var typeInfo = contentType.parse(req);

    // If express has already parsed a body as a string, and the content-type
    // was application/graphql, parse the string body.
    if (typeof req.body === 'string' &&
        typeInfo.type === 'application/graphql') {
      return next(null, graphqlParser(req.body));
    }

    // Already parsed body we didn't recognise? Parse nothing.
    if (req.body) {
      return next();
    }

    // Use the correct body parser based on Content-Type header.
    switch (typeInfo.type) {
      case 'application/graphql':
        return read(req, typeInfo, graphqlParser, next);
      case 'application/json':
        return read(req, typeInfo, jsonEncodedParser, next);
      case 'application/x-www-form-urlencoded':
        return read(req, typeInfo, urlEncodedParser, next);
    }

    // If no Content-Type header matches, parse nothing.
    return next();
  } catch (error) {
    return next(error);
  }
}

type NodeCallback = (error?: ?Error, data?: Object) => void;

function jsonEncodedParser(body) {
  if (jsonObjRegex.test(body)) {
    /* eslint-disable no-empty */
    try {
      return JSON.parse(body);
    } catch (error) {
      // Do nothing
    }
    /* eslint-enable no-empty */
  }
  throw httpError(400, 'POST body sent invalid JSON.');
}

function urlEncodedParser(body) {
  return querystring.parse(body);
}

function graphqlParser(body) {
  return { query: body };
}

/**
 * RegExp to match an Object-opening brace "{" as the first non-space
 * in a string. Allowed whitespace is defined in RFC 7159:
 *
 *     x20  Space
 *     x09  Horizontal tab
 *     x0A  Line feed or New line
 *     x0D  Carriage return
 */
var jsonObjRegex = /^[\x20\x09\x0a\x0d]*\{/;

// Read and parse a request body.
function read(req, typeInfo, parseFn, next) {
  var charset = (typeInfo.parameters.charset || 'utf-8').toLowerCase();

  // Assert charset encoding per JSON RFC 7159 sec 8.1
  if (charset.slice(0, 4) !== 'utf-') {
    throw httpError(415, `Unsupported charset "${charset.toUpperCase()}".`);
  }

  // Get content-encoding (e.g. gzip)
  var encoding = (req.headers['content-encoding'] || 'identity').toLowerCase();
  var length = encoding === 'identity' ? req.headers['content-length'] : null;
  var limit = 100 * 1024; // 100kb
  var stream = decompressed(req, encoding);

  // Read body from stream.
  getBody(stream, { encoding: charset, length, limit }, function (err, body) {
    if (err) {
      return next(
        err.type === 'encoding.unsupported' ?
          httpError(415, `Unsupported charset "${charset.toUpperCase()}".`) :
          httpError(400, `Invalid body: ${err.message}.`)
      );
    }

    try {
      // Decode and parse body.
      return next(null, parseFn(body));
    } catch (error) {
      return next(error);
    }
  });
}

// Return a decompressed stream, given an encoding.
function decompressed(req, encoding) {
  switch (encoding) {
    case 'identity': return req;
    case 'deflate': return req.pipe(zlib.createInflate());
    case 'gzip': return req.pipe(zlib.createGunzip());
  }
  throw httpError(415, `Unsupported content-encoding "${encoding}".`);
}
