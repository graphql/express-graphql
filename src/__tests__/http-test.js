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
import sinon from 'sinon';
import { stringify } from 'querystring';
import url from 'url';
import zlib from 'zlib';
import multer from 'multer';
import bodyParser from 'body-parser';
import request from 'supertest';
import connect from 'connect';
import express4 from 'express'; // modern
import express3 from 'express3'; // old but commonly still used
import restify from 'restify';
import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLNonNull,
  GraphQLString,
  GraphQLError,
  BREAK,
} from 'graphql';
import graphqlHTTP from '../';

const QueryRootType = new GraphQLObjectType({
  name: 'QueryRoot',
  fields: {
    test: {
      type: GraphQLString,
      args: {
        who: {
          type: GraphQLString,
        },
      },
      resolve: (root, { who }) => 'Hello ' + ((who: any) || 'World'),
    },
    nonNullThrower: {
      type: new GraphQLNonNull(GraphQLString),
      resolve: () => {
        throw new Error('Throws!');
      },
    },
    thrower: {
      type: GraphQLString,
      resolve: () => {
        throw new Error('Throws!');
      },
    },
    context: {
      type: GraphQLString,
      resolve: (obj, args, context) => context,
    },
    contextDotFoo: {
      type: GraphQLString,
      resolve: (obj, args, context) => {
        return (context: any).foo;
      },
    },
  },
});

const TestSchema = new GraphQLSchema({
  query: QueryRootType,
  mutation: new GraphQLObjectType({
    name: 'MutationRoot',
    fields: {
      writeTest: {
        type: QueryRootType,
        resolve: () => ({}),
      },
    },
  }),
});

function urlString(urlParams?: ?{ [param: string]: mixed }) {
  let string = '/graphql';
  if (urlParams) {
    string += '?' + stringify(urlParams);
  }
  return string;
}

function promiseTo(fn) {
  return new Promise((resolve, reject) => {
    fn((error, result) => (error ? reject(error) : resolve(result)));
  });
}

describe('test harness', () => {
  it('resolves callback promises', async () => {
    const resolveValue = {};
    const result = await promiseTo(cb => cb(null, resolveValue));
    expect(result).to.equal(resolveValue);
  });

  it('rejects callback promises with errors', async () => {
    const rejectError = new Error();
    let caught;
    try {
      await promiseTo(cb => cb(rejectError));
    } catch (error) {
      caught = error;
    }
    expect(caught).to.equal(rejectError);
  });
});

[
  [connect, 'connect'],
  [express4, 'express-modern'],
  [express3, 'express-old'],
  [restify.createServer, 'restify'],
].forEach(([serverImpl, name]) => {
  function server() {
    const app = serverImpl();
    if (app.set) {
      // This ensures consistent tests, as express defaults json spacing to
      // 0 only in "production" mode.
      app.set('json spaces', 0);
    }
    app.on('error', error => {
      // eslint-disable-next-line no-console
      console.warn('App encountered an error:', error);
    });
    return app;
  }

  function get(app, ...args) {
    // Connect only likes using app.use.
    return app.get ? app.get(...args) : app.use(...args);
  }

  function post(app, ...args) {
    // Connect only likes using app.use.
    return app.post ? app.post(...args) : app.use(...args);
  }

  describe(`GraphQL-HTTP tests for ${name}`, () => {
    describe('GET functionality', () => {
      it('allows GET with query param', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
          }),
        );

        const response = await request(app).get(
          urlString({
            query: '{test}',
          }),
        );

        expect(response.text).to.equal('{"data":{"test":"Hello World"}}');
      });

      it('allows GET with variable values', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
          }),
        );

        const response = await request(app).get(
          urlString({
            query: 'query helloWho($who: String){ test(who: $who) }',
            variables: JSON.stringify({ who: 'Dolly' }),
          }),
        );

        expect(response.text).to.equal('{"data":{"test":"Hello Dolly"}}');
      });

      it('allows GET with operation name', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP(() => ({
            schema: TestSchema,
          })),
        );

        const response = await request(app).get(
          urlString({
            query: `
              query helloYou { test(who: "You"), ...shared }
              query helloWorld { test(who: "World"), ...shared }
              query helloDolly { test(who: "Dolly"), ...shared }
              fragment shared on QueryRoot {
                shared: test(who: "Everyone")
              }
            `,
            operationName: 'helloWorld',
          }),
        );

        expect(JSON.parse(response.text)).to.deep.equal({
          data: {
            test: 'Hello World',
            shared: 'Hello Everyone',
          },
        });
      });

      it('Reports validation errors', async () => {
        const app = server();

        get(app, urlString(), graphqlHTTP({ schema: TestSchema }));

        const response = await request(app).get(
          urlString({
            query: '{ test, unknownOne, unknownTwo }',
          }),
        );

        expect(response.status).to.equal(400);
        expect(JSON.parse(response.text)).to.deep.equal({
          errors: [
            {
              message: 'Cannot query field "unknownOne" on type "QueryRoot".',
              locations: [{ line: 1, column: 9 }],
            },
            {
              message: 'Cannot query field "unknownTwo" on type "QueryRoot".',
              locations: [{ line: 1, column: 21 }],
            },
          ],
        });
      });

      it('Errors when missing operation name', async () => {
        const app = server();

        get(app, urlString(), graphqlHTTP({ schema: TestSchema }));

        const response = await request(app).get(
          urlString({
            query: `
              query TestQuery { test }
              mutation TestMutation { writeTest { test } }
            `,
          }),
        );

        expect(response.status).to.equal(400);
        expect(JSON.parse(response.text)).to.deep.equal({
          errors: [
            {
              message: 'Must provide operation name if query contains multiple operations.',
            },
          ],
        });
      });

      it('Errors when sending a mutation via GET', async () => {
        const app = server();

        get(app, urlString(), graphqlHTTP({ schema: TestSchema }));

        const response = await request(app).get(
          urlString({
            query: 'mutation TestMutation { writeTest { test } }',
          }),
        );

        expect(response.status).to.equal(405);
        expect(JSON.parse(response.text)).to.deep.equal({
          errors: [
            {
              message: 'Can only perform a mutation operation from a POST request.',
            },
          ],
        });
      });

      it('Errors when selecting a mutation within a GET', async () => {
        const app = server();

        get(app, urlString(), graphqlHTTP({ schema: TestSchema }));

        const response = await request(app).get(
          urlString({
            operationName: 'TestMutation',
            query: `
              query TestQuery { test }
              mutation TestMutation { writeTest { test } }
            `,
          }),
        );

        expect(response.status).to.equal(405);
        expect(JSON.parse(response.text)).to.deep.equal({
          errors: [
            {
              message: 'Can only perform a mutation operation from a POST request.',
            },
          ],
        });
      });

      it('Allows a mutation to exist within a GET', async () => {
        const app = server();

        get(app, urlString(), graphqlHTTP({ schema: TestSchema }));

        const response = await request(app).get(
          urlString({
            operationName: 'TestQuery',
            query: `
              mutation TestMutation { writeTest { test } }
              query TestQuery { test }
            `,
          }),
        );

        expect(response.status).to.equal(200);
        expect(JSON.parse(response.text)).to.deep.equal({
          data: {
            test: 'Hello World',
          },
        });
      });

      it('Allows passing in a context', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
            context: 'testValue',
          }),
        );

        const response = await request(app).get(
          urlString({
            operationName: 'TestQuery',
            query: `
              query TestQuery { context }
            `,
          }),
        );

        expect(response.status).to.equal(200);
        expect(JSON.parse(response.text)).to.deep.equal({
          data: {
            context: 'testValue',
          },
        });
      });

      it('Uses request as context by default', async () => {
        const app = server();

        // Middleware that adds req.foo to every request
        app.use((req, res, next) => {
          req.foo = 'bar';
          next();
        });

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
          }),
        );

        const response = await request(app).get(
          urlString({
            operationName: 'TestQuery',
            query: `
              query TestQuery { contextDotFoo }
            `,
          }),
        );

        expect(response.status).to.equal(200);
        expect(JSON.parse(response.text)).to.deep.equal({
          data: {
            contextDotFoo: 'bar',
          },
        });
      });

      it('Allows returning an options Promise', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP(() =>
            Promise.resolve({
              schema: TestSchema,
            }),
          ),
        );

        const response = await request(app).get(
          urlString({
            query: '{test}',
          }),
        );

        expect(response.text).to.equal('{"data":{"test":"Hello World"}}');
      });

      it('Provides an options function with arguments', async () => {
        const app = server();

        let seenRequest;
        let seenResponse;
        let seenParams;

        get(
          app,
          urlString(),
          graphqlHTTP((req, res, params) => {
            seenRequest = req;
            seenResponse = res;
            seenParams = params;
            return { schema: TestSchema };
          }),
        );

        const response = await request(app).get(
          urlString({
            query: '{test}',
          }),
        );

        expect(response.text).to.equal('{"data":{"test":"Hello World"}}');

        expect(seenRequest).to.not.equal(null);
        expect(seenResponse).to.not.equal(null);
        expect(seenParams).to.deep.equal({
          query: '{test}',
          operationName: null,
          variables: null,
          raw: false,
        });
      });

      it('Catches errors thrown from options function', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP(() => {
            throw new Error('I did something wrong');
          }),
        );

        const response = await request(app).get(
          urlString({
            query: '{test}',
          }),
        );

        expect(response.status).to.equal(500);
        expect(response.text).to.equal(
          '{"errors":[{"message":"I did something wrong"}]}',
        );
      });
    });

    describe('POST functionality', () => {
      it('allows POST with JSON encoding', async () => {
        const app = server();

        post(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
          }),
        );

        const response = await request(app)
          .post(urlString())
          .send({ query: '{test}' });

        expect(response.text).to.equal('{"data":{"test":"Hello World"}}');
      });

      it('Allows sending a mutation via POST', async () => {
        const app = server();

        post(app, urlString(), graphqlHTTP({ schema: TestSchema }));

        const response = await request(app)
          .post(urlString())
          .send({ query: 'mutation TestMutation { writeTest { test } }' });

        expect(response.status).to.equal(200);
        expect(response.text).to.equal(
          '{"data":{"writeTest":{"test":"Hello World"}}}',
        );
      });

      it('allows POST with url encoding', async () => {
        const app = server();

        post(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
          }),
        );

        const response = await request(app)
          .post(urlString())
          .send(stringify({ query: '{test}' }));

        expect(response.text).to.equal('{"data":{"test":"Hello World"}}');
      });

      it('supports POST JSON query with string variables', async () => {
        const app = server();

        post(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
          }),
        );

        const response = await request(app).post(urlString()).send({
          query: 'query helloWho($who: String){ test(who: $who) }',
          variables: JSON.stringify({ who: 'Dolly' }),
        });

        expect(response.text).to.equal('{"data":{"test":"Hello Dolly"}}');
      });

      it('supports POST JSON query with JSON variables', async () => {
        const app = server();

        post(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
          }),
        );

        const response = await request(app).post(urlString()).send({
          query: 'query helloWho($who: String){ test(who: $who) }',
          variables: { who: 'Dolly' },
        });

        expect(response.text).to.equal('{"data":{"test":"Hello Dolly"}}');
      });

      it('supports POST url encoded query with string variables', async () => {
        const app = server();

        post(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
          }),
        );

        const response = await request(app).post(urlString()).send(
          stringify({
            query: 'query helloWho($who: String){ test(who: $who) }',
            variables: JSON.stringify({ who: 'Dolly' }),
          }),
        );

        expect(response.text).to.equal('{"data":{"test":"Hello Dolly"}}');
      });

      it('supports POST JSON query with GET variable values', async () => {
        const app = server();

        post(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
          }),
        );

        const response = await request(app)
          .post(
            urlString({
              variables: JSON.stringify({ who: 'Dolly' }),
            }),
          )
          .send({ query: 'query helloWho($who: String){ test(who: $who) }' });

        expect(response.text).to.equal('{"data":{"test":"Hello Dolly"}}');
      });

      it('supports POST url encoded query with GET variable values', async () => {
        const app = server();

        post(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
          }),
        );

        const response = await request(app)
          .post(
            urlString({
              variables: JSON.stringify({ who: 'Dolly' }),
            }),
          )
          .send(
            stringify({
              query: 'query helloWho($who: String){ test(who: $who) }',
            }),
          );

        expect(response.text).to.equal('{"data":{"test":"Hello Dolly"}}');
      });

      it('supports POST raw text query with GET variable values', async () => {
        const app = server();

        post(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
          }),
        );

        const response = await request(app)
          .post(
            urlString({
              variables: JSON.stringify({ who: 'Dolly' }),
            }),
          )
          .set('Content-Type', 'application/graphql')
          .send('query helloWho($who: String){ test(who: $who) }');

        expect(response.text).to.equal('{"data":{"test":"Hello Dolly"}}');
      });

      it('allows POST with operation name', async () => {
        const app = server();

        post(
          app,
          urlString(),
          graphqlHTTP(() => ({
            schema: TestSchema,
          })),
        );

        const response = await request(app).post(urlString()).send({
          query: `
              query helloYou { test(who: "You"), ...shared }
              query helloWorld { test(who: "World"), ...shared }
              query helloDolly { test(who: "Dolly"), ...shared }
              fragment shared on QueryRoot {
                shared: test(who: "Everyone")
              }
            `,
          operationName: 'helloWorld',
        });

        expect(JSON.parse(response.text)).to.deep.equal({
          data: {
            test: 'Hello World',
            shared: 'Hello Everyone',
          },
        });
      });

      it('allows POST with GET operation name', async () => {
        const app = server();

        post(
          app,
          urlString(),
          graphqlHTTP(() => ({
            schema: TestSchema,
          })),
        );

        const response = await request(app)
          .post(
            urlString({
              operationName: 'helloWorld',
            }),
          )
          .set('Content-Type', 'application/graphql').send(`
            query helloYou { test(who: "You"), ...shared }
            query helloWorld { test(who: "World"), ...shared }
            query helloDolly { test(who: "Dolly"), ...shared }
            fragment shared on QueryRoot {
              shared: test(who: "Everyone")
            }
          `);

        expect(JSON.parse(response.text)).to.deep.equal({
          data: {
            test: 'Hello World',
            shared: 'Hello Everyone',
          },
        });
      });

      it('allows other UTF charsets', async () => {
        const app = server();

        post(
          app,
          urlString(),
          graphqlHTTP(() => ({
            schema: TestSchema,
          })),
        );

        const req = request(app)
          .post(urlString())
          .set('Content-Type', 'application/graphql; charset=utf-16');
        req.write(new Buffer('{ test(who: "World") }', 'utf16le'));
        const response = await req;

        expect(JSON.parse(response.text)).to.deep.equal({
          data: {
            test: 'Hello World',
          },
        });
      });

      it('allows gzipped POST bodies', async () => {
        const app = server();

        post(
          app,
          urlString(),
          graphqlHTTP(() => ({
            schema: TestSchema,
          })),
        );

        const data = { query: '{ test(who: "World") }' };
        const json = JSON.stringify(data);
        const gzippedJson = await promiseTo(cb => zlib.gzip(json, cb));

        const req = request(app)
          .post(urlString())
          .set('Content-Type', 'application/json')
          .set('Content-Encoding', 'gzip');
        req.write(gzippedJson);
        const response = await req;

        expect(JSON.parse(response.text)).to.deep.equal({
          data: {
            test: 'Hello World',
          },
        });
      });

      it('allows deflated POST bodies', async () => {
        const app = server();

        post(
          app,
          urlString(),
          graphqlHTTP(() => ({
            schema: TestSchema,
          })),
        );

        const data = { query: '{ test(who: "World") }' };
        const json = JSON.stringify(data);
        const deflatedJson = await promiseTo(cb => zlib.deflate(json, cb));

        const req = request(app)
          .post(urlString())
          .set('Content-Type', 'application/json')
          .set('Content-Encoding', 'deflate');
        req.write(deflatedJson);
        const response = await req;

        expect(JSON.parse(response.text)).to.deep.equal({
          data: {
            test: 'Hello World',
          },
        });
      });

      it('allows for pre-parsed POST bodies', async () => {
        // Note: this is not the only way to handle file uploads with GraphQL,
        // but it is terse and illustrative of using express-graphql and multer
        // together.

        // A simple schema which includes a mutation.
        const UploadedFileType = new GraphQLObjectType({
          name: 'UploadedFile',
          fields: {
            originalname: { type: GraphQLString },
            mimetype: { type: GraphQLString },
          },
        });

        const TestMutationSchema = new GraphQLSchema({
          query: new GraphQLObjectType({
            name: 'QueryRoot',
            fields: {
              test: { type: GraphQLString },
            },
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
                },
              },
            },
          }),
        });

        const app = server();

        // Multer provides multipart form data parsing.
        const storage = multer.memoryStorage();
        app.use(multer({ storage }).single('file'));

        // Providing the request as part of `rootValue` allows it to
        // be accessible from within Schema resolve functions.
        post(
          app,
          urlString(),
          graphqlHTTP(req => {
            return {
              schema: TestMutationSchema,
              rootValue: { request: req },
            };
          }),
        );

        const response = await request(app)
          .post(urlString())
          .field(
            'query',
            `mutation TestMutation {
            uploadFile { originalname, mimetype }
          }`,
          )
          .attach('file', __filename);

        expect(JSON.parse(response.text)).to.deep.equal({
          data: {
            uploadFile: {
              originalname: 'http-test.js',
              mimetype: 'application/javascript',
            },
          },
        });
      });

      it('allows for pre-parsed POST using application/graphql', async () => {
        const app = server();
        app.use(bodyParser.text({ type: 'application/graphql' }));

        post(app, urlString(), graphqlHTTP({ schema: TestSchema }));

        const req = request(app)
          .post(urlString())
          .set('Content-Type', 'application/graphql');
        req.write(new Buffer('{ test(who: "World") }'));
        const response = await req;

        expect(JSON.parse(response.text)).to.deep.equal({
          data: {
            test: 'Hello World',
          },
        });
      });

      it('does not accept unknown pre-parsed POST string', async () => {
        const app = server();
        app.use(bodyParser.text({ type: '*/*' }));

        post(app, urlString(), graphqlHTTP({ schema: TestSchema }));

        const req = request(app).post(urlString());
        req.write(new Buffer('{ test(who: "World") }'));
        const response = await req;

        expect(response.status).to.equal(400);
        expect(JSON.parse(response.text)).to.deep.equal({
          errors: [{ message: 'Must provide query string.' }],
        });
      });

      it('does not accept unknown pre-parsed POST raw Buffer', async () => {
        const app = server();
        app.use(bodyParser.raw({ type: '*/*' }));

        post(app, urlString(), graphqlHTTP({ schema: TestSchema }));

        const req = request(app)
          .post(urlString())
          .set('Content-Type', 'application/graphql');
        req.write(new Buffer('{ test(who: "World") }'));
        const response = await req;

        expect(response.status).to.equal(400);
        expect(JSON.parse(response.text)).to.deep.equal({
          errors: [{ message: 'Must provide query string.' }],
        });
      });
    });

    describe('Response functionality', () => {
      it('does not use send for connect', async () => {
        const app = server();
        let spyEnd = {};
        let spySend = {};

        // mount a middleware to spy on response methods
        app.use((req, res, next) => {
          spyEnd = sinon.spy(res, 'end');
          try {
            // res.send is undefined with connect
            spySend = sinon.spy(res, 'send');
          } catch (err) {
            spySend = undefined;
          }
          next();
        });

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
          }),
        );

        await request(app).get(
          urlString({
            query: '{test}',
          }),
        );

        if (name === 'connect') {
          expect(spyEnd.calledOnce);
          expect(spySend).to.equal(undefined);
        } else {
          expect(spySend.calledOnce);
        }
      });
    });

    describe('Pretty printing', () => {
      it('supports pretty printing', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
            pretty: true,
          }),
        );

        const response = await request(app).get(
          urlString({
            query: '{test}',
          }),
        );

        expect(response.text).to.equal(
          '{\n' +
            '  "data": {\n' +
            '    "test": "Hello World"\n' +
            '  }\n' +
            '}',
        );
      });

      it('supports pretty printing configured by request', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP(req => {
            return {
              schema: TestSchema,
              pretty: ((url.parse(req.url, true) || {}).query || {}).pretty ===
                '1',
            };
          }),
        );

        const defaultResponse = await request(app).get(
          urlString({
            query: '{test}',
          }),
        );

        expect(defaultResponse.text).to.equal(
          '{"data":{"test":"Hello World"}}',
        );

        const prettyResponse = await request(app).get(
          urlString({
            query: '{test}',
            pretty: 1,
          }),
        );

        expect(prettyResponse.text).to.equal(
          '{\n' +
            '  "data": {\n' +
            '    "test": "Hello World"\n' +
            '  }\n' +
            '}',
        );

        const unprettyResponse = await request(app).get(
          urlString({
            query: '{test}',
            pretty: 0,
          }),
        );

        expect(unprettyResponse.text).to.equal(
          '{"data":{"test":"Hello World"}}',
        );
      });
    });

    it('will send request and response when using thunk', async () => {
      const app = server();

      let hasRequest = false;
      let hasResponse = false;

      get(
        app,
        urlString(),
        graphqlHTTP((req, res) => {
          if (req) {
            hasRequest = true;
          }
          if (res) {
            hasResponse = true;
          }
          return { schema: TestSchema };
        }),
      );

      await request(app).get(urlString({ query: '{test}' }));

      expect(hasRequest).to.equal(true);
      expect(hasResponse).to.equal(true);
    });

    describe('Error handling functionality', () => {
      it('handles field errors caught by GraphQL', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
          }),
        );

        const response = await request(app).get(
          urlString({
            query: '{thrower}',
          }),
        );

        expect(response.status).to.equal(200);
        expect(JSON.parse(response.text)).to.deep.equal({
          data: { thrower: null },
          errors: [
            {
              message: 'Throws!',
              locations: [{ line: 1, column: 2 }],
              path: ['thrower'],
            },
          ],
        });
      });

      it('handles query errors from non-null top field errors', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
          }),
        );

        const response = await request(app).get(
          urlString({
            query: '{nonNullThrower}',
          }),
        );

        expect(response.status).to.equal(500);
        expect(JSON.parse(response.text)).to.deep.equal({
          data: null,
          errors: [
            {
              message: 'Throws!',
              locations: [{ line: 1, column: 2 }],
              path: ['nonNullThrower'],
            },
          ],
        });
      });

      it('allows for custom error formatting to sanitize', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
            formatError(error) {
              return { message: 'Custom error format: ' + error.message };
            },
          }),
        );

        const response = await request(app).get(
          urlString({
            query: '{thrower}',
          }),
        );

        expect(response.status).to.equal(200);
        expect(JSON.parse(response.text)).to.deep.equal({
          data: { thrower: null },
          errors: [
            {
              message: 'Custom error format: Throws!',
            },
          ],
        });
      });

      it('allows for custom error formatting to elaborate', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
            formatError(error) {
              return {
                message: error.message,
                locations: error.locations,
                stack: 'Stack trace',
              };
            },
          }),
        );

        const response = await request(app).get(
          urlString({
            query: '{thrower}',
          }),
        );

        expect(response.status).to.equal(200);
        expect(JSON.parse(response.text)).to.deep.equal({
          data: { thrower: null },
          errors: [
            {
              message: 'Throws!',
              locations: [{ line: 1, column: 2 }],
              stack: 'Stack trace',
            },
          ],
        });
      });

      it('handles syntax errors caught by GraphQL', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
          }),
        );

        const response = await request(app).get(
          urlString({
            query: 'syntaxerror',
          }),
        );

        expect(response.status).to.equal(400);
        expect(JSON.parse(response.text)).to.deep.equal({
          errors: [
            {
              message: 'Syntax Error GraphQL request (1:1) ' +
                'Unexpected Name "syntaxerror"\n\n1: syntaxerror\n   ^\n',
              locations: [{ line: 1, column: 1 }],
            },
          ],
        });
      });

      it('handles errors caused by a lack of query', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
          }),
        );

        const response = await request(app).get(urlString());

        expect(response.status).to.equal(400);
        expect(JSON.parse(response.text)).to.deep.equal({
          errors: [{ message: 'Must provide query string.' }],
        });
      });

      it('handles invalid JSON bodies', async () => {
        const app = server();

        post(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
          }),
        );

        const response = await request(app)
          .post(urlString())
          .set('Content-Type', 'application/json')
          .send('[]');

        expect(response.status).to.equal(400);
        expect(JSON.parse(response.text)).to.deep.equal({
          errors: [{ message: 'POST body sent invalid JSON.' }],
        });
      });

      it('handles incomplete JSON bodies', async () => {
        const app = server();

        post(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
          }),
        );

        const response = await request(app)
          .post(urlString())
          .set('Content-Type', 'application/json')
          .send('{"query":');

        expect(response.status).to.equal(400);
        expect(JSON.parse(response.text)).to.deep.equal({
          errors: [{ message: 'POST body sent invalid JSON.' }],
        });
      });

      it('handles plain POST text', async () => {
        const app = server();

        post(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
          }),
        );

        const response = await request(app)
          .post(
            urlString({
              variables: JSON.stringify({ who: 'Dolly' }),
            }),
          )
          .set('Content-Type', 'text/plain')
          .send('query helloWho($who: String){ test(who: $who) }');

        expect(response.status).to.equal(400);
        expect(JSON.parse(response.text)).to.deep.equal({
          errors: [{ message: 'Must provide query string.' }],
        });
      });

      it('handles unsupported charset', async () => {
        const app = server();

        post(
          app,
          urlString(),
          graphqlHTTP(() => ({
            schema: TestSchema,
          })),
        );

        const response = await request(app)
          .post(urlString())
          .set('Content-Type', 'application/graphql; charset=ascii')
          .send('{ test(who: "World") }');

        expect(response.status).to.equal(415);
        expect(JSON.parse(response.text)).to.deep.equal({
          errors: [{ message: 'Unsupported charset "ASCII".' }],
        });
      });

      it('handles unsupported utf charset', async () => {
        const app = server();

        post(
          app,
          urlString(),
          graphqlHTTP(() => ({
            schema: TestSchema,
          })),
        );

        const response = await request(app)
          .post(urlString())
          .set('Content-Type', 'application/graphql; charset=utf-53')
          .send('{ test(who: "World") }');

        expect(response.status).to.equal(415);
        expect(JSON.parse(response.text)).to.deep.equal({
          errors: [{ message: 'Unsupported charset "UTF-53".' }],
        });
      });

      it('handles unknown encoding', async () => {
        const app = server();

        post(
          app,
          urlString(),
          graphqlHTTP(() => ({
            schema: TestSchema,
          })),
        );

        const response = await request(app)
          .post(urlString())
          .set('Content-Encoding', 'garbage')
          .send('!@#$%^*(&^$%#@');

        expect(response.status).to.equal(415);
        expect(JSON.parse(response.text)).to.deep.equal({
          errors: [{ message: 'Unsupported content-encoding "garbage".' }],
        });
      });

      it('handles poorly formed variables', async () => {
        const app = server();

        get(app, urlString(), graphqlHTTP({ schema: TestSchema }));

        const response = await request(app).get(
          urlString({
            variables: 'who:You',
            query: 'query helloWho($who: String){ test(who: $who) }',
          }),
        );

        expect(response.status).to.equal(400);
        expect(JSON.parse(response.text)).to.deep.equal({
          errors: [{ message: 'Variables are invalid JSON.' }],
        });
      });

      it('handles unsupported HTTP methods', async () => {
        // This test doesn't apply to restify because you need to define methods
        // manually for each endpoint.
        if (name === 'restify') {
          return;
        }

        const app = server();

        app.use(urlString(), graphqlHTTP({ schema: TestSchema }));

        const response = await request(app).put(urlString({ query: '{test}' }));

        expect(response.status).to.equal(405);
        expect(response.headers.allow).to.equal('GET, POST');
        expect(JSON.parse(response.text)).to.deep.equal({
          errors: [{ message: 'GraphQL only supports GET and POST requests.' }],
        });
      });
    });

    describe('Built-in GraphiQL support', () => {
      it('does not renders GraphiQL if no opt-in', async () => {
        const app = server();

        get(app, urlString(), graphqlHTTP({ schema: TestSchema }));

        const response = await request(app)
          .get(urlString({ query: '{test}' }))
          .set('Accept', 'text/html');

        expect(response.status).to.equal(200);
        expect(response.type).to.equal('application/json');
        expect(response.text).to.equal('{"data":{"test":"Hello World"}}');
      });

      it('presents GraphiQL when accepting HTML', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
            graphiql: true,
          }),
        );

        const response = await request(app)
          .get(urlString({ query: '{test}' }))
          .set('Accept', 'text/html');

        expect(response.status).to.equal(200);
        expect(response.type).to.equal('text/html');
        expect(response.text).to.include('{test}');
        expect(response.text).to.include('graphiql.min.js');
      });

      it('contains a pre-run response within GraphiQL', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
            graphiql: true,
          }),
        );

        const response = await request(app)
          .get(urlString({ query: '{test}' }))
          .set('Accept', 'text/html');

        expect(response.status).to.equal(200);
        expect(response.type).to.equal('text/html');
        expect(response.text).to.include(
          'response: ' +
            JSON.stringify(
              JSON.stringify({ data: { test: 'Hello World' } }, null, 2),
            ),
        );
      });

      it('contains a pre-run operation name within GraphiQL', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
            graphiql: true,
          }),
        );

        const response = await request(app)
          .get(
            urlString({
              query: 'query A{a:test} query B{b:test}',
              operationName: 'B',
            }),
          )
          .set('Accept', 'text/html');

        expect(response.status).to.equal(200);
        expect(response.type).to.equal('text/html');
        expect(response.text).to.include(
          'response: ' +
            JSON.stringify(
              JSON.stringify({ data: { b: 'Hello World' } }, null, 2),
            ),
        );
        expect(response.text).to.include('operationName: "B"');
      });

      it('escapes HTML in queries within GraphiQL', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
            graphiql: true,
          }),
        );

        const response = await request(app)
          .get(urlString({ query: '</script><script>alert(1)</script>' }))
          .set('Accept', 'text/html');

        expect(response.status).to.equal(400);
        expect(response.type).to.equal('text/html');
        expect(response.text).to.not.include(
          '</script><script>alert(1)</script>',
        );
      });

      it('escapes HTML in variables within GraphiQL', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
            graphiql: true,
          }),
        );

        const response = await request(app)
          .get(
            urlString({
              query: 'query helloWho($who: String) { test(who: $who) }',
              variables: JSON.stringify({
                who: '</script><script>alert(1)</script>',
              }),
            }),
          )
          .set('Accept', 'text/html');

        expect(response.status).to.equal(200);
        expect(response.type).to.equal('text/html');
        expect(response.text).to.not.include(
          '</script><script>alert(1)</script>',
        );
      });

      it('GraphiQL renders provided variables', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
            graphiql: true,
          }),
        );

        const response = await request(app)
          .get(
            urlString({
              query: 'query helloWho($who: String) { test(who: $who) }',
              variables: JSON.stringify({ who: 'Dolly' }),
            }),
          )
          .set('Accept', 'text/html');

        expect(response.status).to.equal(200);
        expect(response.type).to.equal('text/html');
        expect(response.text).to.include(
          'variables: ' +
            JSON.stringify(JSON.stringify({ who: 'Dolly' }, null, 2)),
        );
      });

      it('GraphiQL accepts an empty query', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
            graphiql: true,
          }),
        );

        const response = await request(app)
          .get(urlString())
          .set('Accept', 'text/html');

        expect(response.status).to.equal(200);
        expect(response.type).to.equal('text/html');
        expect(response.text).to.include('response: undefined');
      });

      it('GraphiQL accepts a mutation query - does not execute it', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
            graphiql: true,
          }),
        );

        const response = await request(app)
          .get(
            urlString({
              query: 'mutation TestMutation { writeTest { test } }',
            }),
          )
          .set('Accept', 'text/html');

        expect(response.status).to.equal(200);
        expect(response.type).to.equal('text/html');
        expect(response.text).to.include(
          'query: "mutation TestMutation { writeTest { test } }"',
        );
        expect(response.text).to.include('response: undefined');
      });

      it('returns HTML if preferred', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
            graphiql: true,
          }),
        );

        const response = await request(app)
          .get(urlString({ query: '{test}' }))
          .set('Accept', 'text/html,application/json');

        expect(response.status).to.equal(200);
        expect(response.type).to.equal('text/html');
        expect(response.text).to.include('graphiql.min.js');
      });

      it('returns JSON if preferred', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
            graphiql: true,
          }),
        );

        const response = await request(app)
          .get(urlString({ query: '{test}' }))
          .set('Accept', 'application/json,text/html');

        expect(response.status).to.equal(200);
        expect(response.type).to.equal('application/json');
        expect(response.text).to.equal('{"data":{"test":"Hello World"}}');
      });

      it('prefers JSON if unknown accept', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
            graphiql: true,
          }),
        );

        const response = await request(app)
          .get(urlString({ query: '{test}' }))
          .set('Accept', 'unknown');

        expect(response.status).to.equal(200);
        expect(response.type).to.equal('application/json');
        expect(response.text).to.equal('{"data":{"test":"Hello World"}}');
      });

      it('prefers JSON if explicitly requested raw response', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
            graphiql: true,
          }),
        );

        const response = await request(app)
          .get(urlString({ query: '{test}', raw: '' }))
          .set('Accept', 'text/html');

        expect(response.status).to.equal(200);
        expect(response.type).to.equal('application/json');
        expect(response.text).to.equal('{"data":{"test":"Hello World"}}');
      });
    });

    describe('Custom validation rules', () => {
      const AlwaysInvalidRule = function(context) {
        return {
          enter() {
            context.reportError(
              new GraphQLError('AlwaysInvalidRule was really invalid!'),
            );
            return BREAK;
          },
        };
      };

      it('Do not execute a query if it do not pass the custom validation.', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
            validationRules: [AlwaysInvalidRule],
            pretty: true,
          }),
        );

        const response = await request(app).get(
          urlString({
            query: '{thrower}',
          }),
        );

        expect(response.status).to.equal(400);
        expect(JSON.parse(response.text)).to.deep.equal({
          errors: [
            {
              message: 'AlwaysInvalidRule was really invalid!',
            },
          ],
        });
      });
    });

    describe('Custom result extensions', () => {
      it('allows for adding extensions', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP(() => {
            const startTime = 1000000000; /* Date.now(); */
            return {
              schema: TestSchema,
              extensions() {
                return { runTime: 1000000010 /* Date.now() */ - startTime };
              },
            };
          }),
        );

        const response = await request(app)
          .get(urlString({ query: '{test}', raw: '' }))
          .set('Accept', 'text/html');

        expect(response.status).to.equal(200);
        expect(response.type).to.equal('application/json');
        expect(response.text).to.equal(
          '{"data":{"test":"Hello World"},"extensions":{"runTime":10}}',
        );
      });

      it('extensions have access to initial GraphQL result', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
            formatError: () => null,
            extensions({ result }) {
              return { preservedErrors: (result: any).errors };
            },
          }),
        );

        const response = await request(app).get(
          urlString({
            query: '{thrower}',
          }),
        );

        expect(response.status).to.equal(200);
        expect(JSON.parse(response.text)).to.deep.equal({
          data: { thrower: null },
          errors: [null],
          extensions: {
            preservedErrors: [
              {
                message: 'Throws!',
                locations: [{ line: 1, column: 2 }],
                path: ['thrower'],
              },
            ],
          },
        });
      });

      it('extension function may be async', async () => {
        const app = server();

        get(
          app,
          urlString(),
          graphqlHTTP({
            schema: TestSchema,
            async extensions() {
              // Note: you can await arbitrary things here!
              return { eventually: 42 };
            },
          }),
        );

        const response = await request(app)
          .get(urlString({ query: '{test}', raw: '' }))
          .set('Accept', 'text/html');

        expect(response.status).to.equal(200);
        expect(response.type).to.equal('application/json');
        expect(response.text).to.equal(
          '{"data":{"test":"Hello World"},"extensions":{"eventually":42}}',
        );
      });
    });
  });
});
