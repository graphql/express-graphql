/**
 *  Copyright (c) 2015-present, Facebook, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 *
 *  @flow strict
 */

import zlib from 'zlib';
import getBody from 'raw-body';
import httpError from 'http-errors';
import querystring from 'querystring';
import contentType from 'content-type';

import { type $Request } from 'express';

/**
 * Provided a "Request" provided by express or connect (typically a node style
 * HTTPClientRequest), Promise the body data contained.
 */
export async function parseBody(
  req: $Request,
): Promise<{ [param: string]: mixed }> {
  const body = req.body;

  // If express has already parsed a body as a keyed object, use it.
  if (typeof body === 'object' && !(body instanceof Buffer)) {
    return (body: any);
  }

  // Skip requests without content types.
  if (req.headers['content-type'] === undefined) {
    return {};
  }

  const typeInfo = contentType.parse(req);

  // If express has already parsed a body as a string, and the content-type
  // was application/graphql, parse the string body.
  if (typeof body === 'string' && typeInfo.type === 'application/graphql') {
    return { query: body };
  }

  // Already parsed body we didn't recognise? Parse nothing.
  if (body) {
    return {};
  }

  const rawBody = await readBody(req, typeInfo);
  // Use the correct body parser based on Content-Type header.
  switch (typeInfo.type) {
    case 'application/graphql':
      return { query: rawBody };
    case 'application/json':
      if (jsonObjRegex.test(rawBody)) {
        /* eslint-disable no-empty */
        try {
          return JSON.parse(rawBody);
        } catch (error) {
          // Do nothing
        }
        /* eslint-enable no-empty */
      }
      throw httpError(400, 'POST body sent invalid JSON.');
    case 'application/x-www-form-urlencoded':
      return querystring.parse(rawBody);
  }

  // If no Content-Type header matches, parse nothing.
  return {};
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
const jsonObjRegex = /^[\x20\x09\x0a\x0d]*\{/;

// Read and parse a request body.
async function readBody(req, typeInfo) {
  const charset = (typeInfo.parameters.charset || 'utf-8').toLowerCase();

  // Assert charset encoding per JSON RFC 7159 sec 8.1
  if (charset.slice(0, 4) !== 'utf-') {
    throw httpError(415, `Unsupported charset "${charset.toUpperCase()}".`);
  }

  // Get content-encoding (e.g. gzip)
  const contentEncoding = req.headers['content-encoding'];
  const encoding =
    typeof contentEncoding === 'string'
      ? contentEncoding.toLowerCase()
      : 'identity';
  const length = encoding === 'identity' ? req.headers['content-length'] : null;
  const limit = 100 * 1024; // 100kb
  const stream = decompressed(req, encoding);

  // Read body from stream.
  try {
    return await getBody(stream, { encoding: charset, length, limit });
  } catch (err) {
    throw err.type === 'encoding.unsupported'
      ? httpError(415, `Unsupported charset "${charset.toUpperCase()}".`)
      : httpError(400, `Invalid body: ${err.message}.`);
  }
}

// Return a decompressed stream, given an encoding.
function decompressed(req, encoding) {
  switch (encoding) {
    case 'identity':
      return req;
    case 'deflate':
      return req.pipe(zlib.createInflate());
    case 'gzip':
      return req.pipe(zlib.createGunzip());
  }
  throw httpError(415, `Unsupported content-encoding "${encoding}".`);
}
