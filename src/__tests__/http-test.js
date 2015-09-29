/* @flow */
/**
 *  Copyright (c) 2015, Facebook, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 */

// 80+ char lines are useful in describe/it, so ignore in this file.
/* eslint-disable max-len */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { stringify } from 'querystring';
import zlib from 'zlib';
import multer from 'multer';
import bodyParser from 'body-parser';
import request from 'supertest-as-promised';
import express4 from 'express'; // modern
import express3 from 'express3'; // old but commonly still used
import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLNonNull,
  GraphQLString
} from 'graphql';
import graphqlHTTP from '../';


var TestSchema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: 'Root',
    fields: {
      test: {
        type: GraphQLString,
        args: {
          who: {
            type: GraphQLString
          }
        },
        resolve: (root, { who }) => 'Hello ' + (who || 'World')
      },
      thrower: {
        type: new GraphQLNonNull(GraphQLString),
        resolve: () => { throw new Error('Throws!'); }
      }
    }
  })
});

function urlString(urlParams?: ?Object) {
  var string = '/graphql';
  if (urlParams) {
    string += ('?' + stringify(urlParams));
  }
  return string;
}

function catchError(p: any): Promise<any> {
  return p.then(
    () => { throw new Error('Expected to catch error.'); },
    error => {
      if (!(error instanceof Error)) {
        throw new Error('Expected to catch error.');
      }
      return error;
    }
  );
}

function promiseTo(fn) {
  return new Promise((resolve, reject) => {
    fn((error, result) => error ? reject(error) : resolve(result));
  });
}

describe('test harness', () => {

  it('expects to catch errors', async () => {
    var caught;
    try {
      await catchError(Promise.resolve());
    } catch (error) {
      caught = error;
    }
    expect(caught && caught.message).to.equal('Expected to catch error.');
  });

  it('expects to catch actual errors', async () => {
    var caught;
    try {
      await catchError(Promise.reject('not a real error'));
    } catch (error) {
      caught = error;
    }
    expect(caught && caught.message).to.equal('Expected to catch error.');
  });

  it('resolves callback promises', async () => {
    var resolveValue = {};
    var result = await promiseTo(cb => cb(null, resolveValue));
    expect(result).to.equal(resolveValue);
  });

  it('rejects callback promises with errors', async () => {
    var rejectError = new Error();
    var caught;
    try {
      await promiseTo(cb => cb(rejectError));
    } catch (error) {
      caught = error;
    }
    expect(caught).to.equal(rejectError);
  });

});

[[ express4, 'modern' ], [ express3, 'old' ]].forEach(([ express, version ]) => {
  describe(`GraphQL-HTTP tests for ${version} mocha`, () => {
    describe('GET functionality', () => {
      it('allows GET with query param', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP({
          schema: TestSchema
        }));

        var response = await request(app)
          .get(urlString({
            query: '{test}'
          }));

        expect(response.text).to.equal(
          '{"data":{"test":"Hello World"}}'
        );
      });

      it('allows GET with variable values', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP({
          schema: TestSchema
        }));

        var response = await request(app)
          .get(urlString({
            query: 'query helloWho($who: String){ test(who: $who) }',
            variables: JSON.stringify({ who: 'Dolly' })
          }));

        expect(response.text).to.equal(
          '{"data":{"test":"Hello Dolly"}}'
        );
      });

      it('allows GET with operation name', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP(() => ({
          schema: TestSchema
        })));

        var response = await request(app)
          .get(urlString({
            query: `
              query helloYou { test(who: "You"), ...shared }
              query helloWorld { test(who: "World"), ...shared }
              query helloDolly { test(who: "Dolly"), ...shared }
              fragment shared on Root {
                shared: test(who: "Everyone")
              }
            `,
            operationName: 'helloWorld'
          }));

        expect(JSON.parse(response.text)).to.deep.equal({
          data: {
            test: 'Hello World',
            shared: 'Hello Everyone',
          }
        });
      });

    });

    describe('POST functionality', () => {
      it('allows POST with JSON encoding', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP({
          schema: TestSchema
        }));

        var response = await request(app)
          .post(urlString()).send({ query: '{test}' });

        expect(response.text).to.equal(
          '{"data":{"test":"Hello World"}}'
        );
      });

      it('allows POST with url encoding', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP({
          schema: TestSchema
        }));

        var response = await request(app)
          .post(urlString())
          .send(stringify({ query: '{test}' }));

        expect(response.text).to.equal(
          '{"data":{"test":"Hello World"}}'
        );
      });

      it('supports POST JSON query with string variables', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP({
          schema: TestSchema
        }));

        var response = await request(app)
          .post(urlString())
          .send({
            query: 'query helloWho($who: String){ test(who: $who) }',
            variables: JSON.stringify({ who: 'Dolly' })
          });

        expect(response.text).to.equal(
          '{"data":{"test":"Hello Dolly"}}'
        );
      });

      it('supports POST JSON query with JSON variables', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP({
          schema: TestSchema
        }));

        var response = await request(app)
          .post(urlString())
          .send({
            query: 'query helloWho($who: String){ test(who: $who) }',
            variables: { who: 'Dolly' }
          });

        expect(response.text).to.equal(
          '{"data":{"test":"Hello Dolly"}}'
        );
      });

      it('supports POST url encoded query with string variables', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP({
          schema: TestSchema
        }));

        var response = await request(app)
          .post(urlString())
          .send(stringify({
            query: 'query helloWho($who: String){ test(who: $who) }',
            variables: JSON.stringify({ who: 'Dolly' })
          }));

        expect(response.text).to.equal(
          '{"data":{"test":"Hello Dolly"}}'
        );
      });

      it('supports POST JSON query with GET variable values', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP({
          schema: TestSchema
        }));

        var response = await request(app)
          .post(urlString({
            variables: JSON.stringify({ who: 'Dolly' })
          }))
          .send({ query: 'query helloWho($who: String){ test(who: $who) }' });

        expect(response.text).to.equal(
          '{"data":{"test":"Hello Dolly"}}'
        );
      });

      it('supports POST url encoded query with GET variable values', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP({
          schema: TestSchema
        }));

        var response = await request(app)
          .post(urlString({
            variables: JSON.stringify({ who: 'Dolly' })
          }))
          .send(stringify({
            query: 'query helloWho($who: String){ test(who: $who) }'
          }));

        expect(response.text).to.equal(
          '{"data":{"test":"Hello Dolly"}}'
        );
      });

      it('supports POST raw text query with GET variable values', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP({
          schema: TestSchema
        }));

        var response = await request(app)
          .post(urlString({
            variables: JSON.stringify({ who: 'Dolly' })
          }))
          .set('Content-Type', 'application/graphql')
          .send('query helloWho($who: String){ test(who: $who) }');

        expect(response.text).to.equal(
          '{"data":{"test":"Hello Dolly"}}'
        );
      });

      it('allows POST with operation name', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP(() => ({
          schema: TestSchema
        })));

        var response = await request(app)
          .post(urlString())
          .send({
            query: `
              query helloYou { test(who: "You"), ...shared }
              query helloWorld { test(who: "World"), ...shared }
              query helloDolly { test(who: "Dolly"), ...shared }
              fragment shared on Root {
                shared: test(who: "Everyone")
              }
            `,
            operationName: 'helloWorld'
          });

        expect(JSON.parse(response.text)).to.deep.equal({
          data: {
            test: 'Hello World',
            shared: 'Hello Everyone',
          }
        });
      });

      it('allows POST with GET operation name', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP(() => ({
          schema: TestSchema
        })));

        var response = await request(app)
          .post(urlString({
            operationName: 'helloWorld'
          }))
          .set('Content-Type', 'application/graphql')
          .send(`
            query helloYou { test(who: "You"), ...shared }
            query helloWorld { test(who: "World"), ...shared }
            query helloDolly { test(who: "Dolly"), ...shared }
            fragment shared on Root {
              shared: test(who: "Everyone")
            }
          `);

        expect(JSON.parse(response.text)).to.deep.equal({
          data: {
            test: 'Hello World',
            shared: 'Hello Everyone',
          }
        });
      });

      it('allows other UTF charsets', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP(() => ({
          schema: TestSchema
        })));

        var req = request(app)
          .post(urlString())
          .set('Content-Type', 'application/graphql; charset=utf-16');
        req.write(new Buffer('{ test(who: "World") }', 'utf16le'));
        var response = await req;

        expect(JSON.parse(response.text)).to.deep.equal({
          data: {
            test: 'Hello World'
          }
        });
      });

      it('allows gzipped POST bodies', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP(() => ({
          schema: TestSchema
        })));

        var data = { query: '{ test(who: "World") }' };
        var json = JSON.stringify(data);
        var gzippedJson = await promiseTo(cb => zlib.gzip(json, cb));

        var req = request(app)
          .post(urlString())
          .set('Content-Type', 'application/json')
          .set('Content-Encoding', 'gzip');
        req.write(gzippedJson);
        var response = await req;

        expect(JSON.parse(response.text)).to.deep.equal({
          data: {
            test: 'Hello World'
          }
        });
      });

      it('allows deflated POST bodies', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP(() => ({
          schema: TestSchema
        })));

        var data = { query: '{ test(who: "World") }' };
        var json = JSON.stringify(data);
        var deflatedJson = await promiseTo(cb => zlib.deflate(json, cb));

        var req = request(app)
          .post(urlString())
          .set('Content-Type', 'application/json')
          .set('Content-Encoding', 'deflate');
        req.write(deflatedJson);
        var response = await req;

        expect(JSON.parse(response.text)).to.deep.equal({
          data: {
            test: 'Hello World'
          }
        });
      });

      it('allows for pre-parsed POST bodies', async () => {
        // Note: this is not the only way to handle file uploads with GraphQL,
        // but it is terse and illustrative of using express-graphql and multer
        // together.

        // A simple schema which includes a mutation.
        var UploadedFileType = new GraphQLObjectType({
          name: 'UploadedFile',
          fields: {
            originalname: { type: GraphQLString },
            mimetype: { type: GraphQLString }
          }
        });

        var TestMutationSchema = new GraphQLSchema({
          query: new GraphQLObjectType({
            name: 'QueryRoot',
            fields: {
              test: { type: GraphQLString }
            }
          }),
          mutation: new GraphQLObjectType({
            name: 'MutationRoot',
            fields: {
              uploadFile: {
                type: UploadedFileType,
                resolve(rootValue) {
                  // For this test demo, we're just returning the uploaded
                  // file directly, but presumably you might return a Promise
                  // to go store the file somewhere first.
                  return rootValue.request.file;
                }
              }
            }
          })
        });

        var app = express();

        // Multer provides multipart form data parsing.
        var storage = multer.memoryStorage();
        app.use(urlString(), multer({ storage }).single('file'));

        // Providing the request as part of `rootValue` allows it to
        // be accessible from within Schema resolve functions.
        app.use(urlString(), graphqlHTTP(req => {
          return {
            schema: TestMutationSchema,
            rootValue: { request: req }
          };
        }));

        var response = await request(app)
          .post(urlString())
          .field('query', `mutation TestMutation {
            uploadFile { originalname, mimetype }
          }`)
          .attach('file', __filename);

        expect(JSON.parse(response.text)).to.deep.equal({
          data: {
            uploadFile: {
              originalname: 'http-test.js',
              mimetype: 'application/javascript'
            }
          }
        });
      });

      it('allows for pre-parsed POST using application/graphql', async () => {
        var app = express();
        app.use(bodyParser.text({ type: 'application/graphql' }));

        app.use(urlString(), graphqlHTTP({ schema: TestSchema }));

        var req = request(app)
          .post(urlString())
          .set('Content-Type', 'application/graphql');
        req.write(new Buffer('{ test(who: "World") }'));
        var response = await req;

        expect(JSON.parse(response.text)).to.deep.equal({
          data: {
            test: 'Hello World'
          }
        });
      });

      it('does not accept unknown pre-parsed POST string', async () => {
        var app = express();
        app.use(bodyParser.text({ type: '*/*' }));

        app.use(urlString(), graphqlHTTP({ schema: TestSchema }));

        var req = request(app)
          .post(urlString());
        req.write(new Buffer('{ test(who: "World") }'));
        var error = await catchError(req);

        expect(error.response.status).to.equal(400);
        expect(JSON.parse(error.response.text)).to.deep.equal({
          errors: [ { message: 'Must provide query string.' } ]
        });
      });

      it('does not accept unknown pre-parsed POST raw Buffer', async () => {
        var app = express();
        app.use(bodyParser.raw({ type: '*/*' }));

        app.use(urlString(), graphqlHTTP({ schema: TestSchema }));

        var req = request(app)
          .post(urlString())
          .set('Content-Type', 'application/graphql');
        req.write(new Buffer('{ test(who: "World") }'));
        var error = await catchError(req);

        expect(error.response.status).to.equal(400);
        expect(JSON.parse(error.response.text)).to.deep.equal({
          errors: [ { message: 'Must provide query string.' } ]
        });
      });
    });

    describe('Pretty printing', () => {
      it('supports pretty printing', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP({
          schema: TestSchema,
          pretty: true
        }));

        var response = await request(app)
          .get(urlString({
            query: '{test}'
          }));

        expect(response.text).to.equal(
          '{\n' +
          '  "data": {\n' +
          '    "test": "Hello World"\n' +
          '  }\n' +
          '}'
        );
      });

      it('supports pretty printing configured by request', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP(req => {
          return {
            schema: TestSchema,
            pretty: req.query.pretty === '1'
          };
        }));

        var defaultResponse = await request(app)
          .get(urlString({
            query: '{test}'
          }));

        expect(defaultResponse.text).to.equal(
          '{"data":{"test":"Hello World"}}'
        );

        var prettyResponse = await request(app)
          .get(urlString({
            query: '{test}',
            pretty: 1
          }));

        expect(prettyResponse.text).to.equal(
          '{\n' +
          '  "data": {\n' +
          '    "test": "Hello World"\n' +
          '  }\n' +
          '}'
        );

        var unprettyResponse = await request(app)
          .get(urlString({
            query: '{test}',
            pretty: 0
          }));

        expect(unprettyResponse.text).to.equal(
          '{"data":{"test":"Hello World"}}'
        );
      });
    });

    describe('Error handling functionality', () => {
      it('handles field errors caught by GraphQL', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP({
          schema: TestSchema,
          pretty: true
        }));

        var response = await request(app)
          .get(urlString({
            query: '{thrower}',
          }));

        expect(response.status).to.equal(200);
        expect(JSON.parse(response.text)).to.deep.equal({
          data: null,
          errors: [ {
            message: 'Throws!',
            locations: [ { line: 1, column: 2 } ]
          } ]
        });
      });

      it('handles syntax errors caught by GraphQL', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP({
          schema: TestSchema,
          pretty: true
        }));

        var error = await catchError(
          request(app)
            .get(urlString({
              query: 'syntaxerror',
            }))
        );

        expect(error.response.status).to.equal(400);
        expect(JSON.parse(error.response.text)).to.deep.equal({
          errors: [ {
            message: 'Syntax Error GraphQL request (1:1) ' +
              'Unexpected Name \"syntaxerror\"\n\n1: syntaxerror\n   ^\n',
            locations: [ { line: 1, column: 1 } ]
          } ]
        });
      });

      it('handles errors caused by a lack of query', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP({
          schema: TestSchema,
          pretty: true
        }));

        var error = await catchError(
          request(app).get(urlString())
        );

        expect(error.response.status).to.equal(400);
        expect(JSON.parse(error.response.text)).to.deep.equal({
          errors: [ { message: 'Must provide query string.' } ]
        });
      });

      it('handles invalid JSON bodies', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP({
          schema: TestSchema,
          pretty: true
        }));

        var error = await catchError(
          request(app)
            .post(urlString())
            .set('Content-Type', 'application/json')
            .send('[]')
        );

        expect(error.response.status).to.equal(400);
        expect(JSON.parse(error.response.text)).to.deep.equal({
          errors: [ { message: 'POST body sent invalid JSON.' } ]
        });
      });

      it('handles incomplete JSON bodies', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP({
          schema: TestSchema,
          pretty: true
        }));

        var error = await catchError(
          request(app)
            .post(urlString())
            .set('Content-Type', 'application/json')
            .send('{"query":')
        );

        expect(error.response.status).to.equal(400);
        expect(JSON.parse(error.response.text)).to.deep.equal({
          errors: [ { message: 'POST body sent invalid JSON.' } ]
        });
      });

      it('handles plain POST text', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP({
          schema: TestSchema
        }));

        var error = await catchError(
          request(app)
            .post(urlString({
              variables: JSON.stringify({ who: 'Dolly' })
            }))
            .set('Content-Type', 'text/plain')
            .send('query helloWho($who: String){ test(who: $who) }')
        );

        expect(error.response.status).to.equal(400);
        expect(JSON.parse(error.response.text)).to.deep.equal({
          errors: [ { message: 'Must provide query string.' } ]
        });
      });

      it('handles unsupported charset', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP(() => ({
          schema: TestSchema
        })));

        var error = await catchError(
          request(app)
            .post(urlString())
            .set('Content-Type', 'application/graphql; charset=ascii')
            .send('{ test(who: "World") }')
        );

        expect(error.response.status).to.equal(415);
        expect(JSON.parse(error.response.text)).to.deep.equal({
          errors: [ { message: 'Unsupported charset "ASCII".' } ]
        });
      });

      it('handles unsupported utf charset', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP(() => ({
          schema: TestSchema
        })));

        var error = await catchError(
          request(app)
            .post(urlString())
            .set('Content-Type', 'application/graphql; charset=utf-53')
            .send('{ test(who: "World") }')
        );

        expect(error.response.status).to.equal(415);
        expect(JSON.parse(error.response.text)).to.deep.equal({
          errors: [ { message: 'Unsupported charset "UTF-53".' } ]
        });
      });

      it('handles unknown encoding', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP(() => ({
          schema: TestSchema
        })));

        var error = await catchError(
          request(app)
            .post(urlString())
            .set('Content-Encoding', 'garbage')
            .send('!@#$%^*(&^$%#@')
        );

        expect(error.response.status).to.equal(415);
        expect(JSON.parse(error.response.text)).to.deep.equal({
          errors: [ { message: 'Unsupported content-encoding "garbage".' } ]
        });
      });

      it('handles poorly formed variables', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP({ schema: TestSchema }));

        var error = await catchError(
          request(app)
            .get(urlString({
              variables: 'who:You',
              query: 'query helloWho($who: String){ test(who: $who) }'
            }))
        );

        expect(error.response.status).to.equal(400);
        expect(JSON.parse(error.response.text)).to.deep.equal({
          errors: [ { message: 'Variables are invalid JSON.' } ]
        });
      });

      it('handles unsupported HTTP methods', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP({ schema: TestSchema }));

        var error = await catchError(
          request(app)
            .put(urlString({ query: '{test}' }))
        );

        expect(error.response.status).to.equal(405);
        expect(error.response.headers.allow).to.equal('GET, POST');
        expect(JSON.parse(error.response.text)).to.deep.equal({
          errors: [
            { message: 'GraphQL only supports GET and POST requests.' }
          ]
        });
      });

    });
  });
});
