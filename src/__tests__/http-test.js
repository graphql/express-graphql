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
// Also ignore no-unused-expressions rule as chai 'expect' syntax violates it.
/* eslint-disable max-len */
/* eslint-disable no-unused-expressions */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import sinon from 'sinon';
import { stringify } from 'querystring';
import zlib from 'zlib';
import multer from 'multer';
import bodyParser from 'body-parser';
import request from 'supertest-as-promised';
import connect from 'connect';
import express3 from 'express3'; // deprecated but commonly still used
import express4 from 'express'; // current
import restify4 from 'restify';
import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLNonNull,
  GraphQLString,
  GraphQLError,
  BREAK
} from 'graphql';
import graphqlHTTP from '../';
import { LRUMap } from 'lru_map';

const QueryRootType = new GraphQLObjectType({
  name: 'QueryRoot',
  fields: {
    test: {
      type: GraphQLString,
      args: {
        who: {
          type: GraphQLString
        }
      },
      resolve: (root, { who }) => 'Hello ' + ((who: any) || 'World')
    },
    nonNullThrower: {
      type: new GraphQLNonNull(GraphQLString),
      resolve: () => { throw new Error('Throws!'); }
    },
    thrower: {
      type: GraphQLString,
      resolve: () => { throw new Error('Throws!'); }
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
  }
});

const TestSchema = new GraphQLSchema({
  query: QueryRootType,
  mutation: new GraphQLObjectType({
    name: 'MutationRoot',
    fields: {
      writeTest: {
        type: QueryRootType,
        resolve: () => ({})
      }
    }
  })
});

function urlString(urlParams?: ?{[param: string]: mixed}) {
  let string = '/graphql';
  if (urlParams) {
    string += ('?' + stringify(urlParams));
  }
  return string;
}

function promiseTo(fn) {
  return new Promise((resolve, reject) => {
    fn((error, result) => error ? reject(error) : resolve(result));
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

const basicConfig = [ urlString(), graphqlHTTP({ schema: TestSchema }) ];

([
  [ connect, 'connect' ],
  [ express3, 'express-legacy' ],
  [ express4, 'express-current' ],
  [ restify4, 'restify' ]
])
.forEach(([ server, name ]) => {
  describe(`GraphQL-HTTP tests for ${name}`, () => {
    let app;
    beforeEach(() => {
      app = name === 'restify' ? server.createServer() : server();
    });

    describe('GET functionality', () => {
      describe('Without context', () => {
        beforeEach(() => {
          if (name === 'restify') {
            app.get(...basicConfig);
          } else {
            app.use(...basicConfig);
          }
        });

        it('allows GET with query param', async () => {
          const response = await request(app)
            .get(urlString({
              query: '{test}'
            }));

          expect(JSON.parse(response.text)).to.deep.equal({
            data: { test: 'Hello World' }
          });
        });

        it('allows GET with variable values', async () => {
          const response = await request(app)
            .get(urlString({
              query: 'query helloWho($who: String){ test(who: $who) }',
              variables: JSON.stringify({ who: 'Dolly' })
            }));

          expect(JSON.parse(response.text)).to.deep.equal({
            data: { test: 'Hello Dolly' }
          });
        });

        it('allows GET with operation name', async () => {
          const response = await request(app)
            .get(urlString({
              query: `
                query helloYou { test(who: "You"), ...shared }
                query helloWorld { test(who: "World"), ...shared }
                query helloDolly { test(who: "Dolly"), ...shared }
                fragment shared on QueryRoot {
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

        it('Reports validation errors', async () => {
          const response = await request(app)
            .get(urlString({
              query: '{ test, unknownOne, unknownTwo }'
            }));

          expect(response.status).to.equal(400);
          expect(JSON.parse(response.text)).to.deep.equal({
            errors: [
              {
                message: 'Cannot query field "unknownOne" on type "QueryRoot".',
                locations: [ { line: 1, column: 9 } ]
              },
              {
                message: 'Cannot query field "unknownTwo" on type "QueryRoot".',
                locations: [ { line: 1, column: 21 } ]
              }
            ]
          });
        });

        it('Errors when missing operation name', async () => {
          const response = await request(app)
            .get(urlString({
              query: `
                query TestQuery { test }
                mutation TestMutation { writeTest { test } }
              `
            }));

          expect(response.status).to.equal(400);
          expect(JSON.parse(response.text)).to.deep.equal({
            errors: [
              { message: 'Must provide operation name if query contains multiple operations.' }
            ]
          });
        });

        it('Errors when sending a mutation via GET', async () => {
          const response = await request(app)
            .get(urlString({
              query: 'mutation TestMutation { writeTest { test } }'
            }));

          expect(response.status).to.equal(405);
          expect(JSON.parse(response.text)).to.deep.equal({
            errors: [
              { message: 'Can only perform a mutation operation from a POST request.' }
            ]
          });
        });

        it('Errors when selecting a mutation within a GET', async () => {
          const response = await request(app)
            .get(urlString({
              operationName: 'TestMutation',
              query: `
                query TestQuery { test }
                mutation TestMutation { writeTest { test } }
              `
            }));

          expect(response.status).to.equal(405);
          expect(JSON.parse(response.text)).to.deep.equal({
            errors: [
              { message: 'Can only perform a mutation operation from a POST request.' }
            ]
          });
        });

        it('Allows a mutation to exist within a GET', async () => {
          const response = await request(app)
            .get(urlString({
              operationName: 'TestQuery',
              query: `
                mutation TestMutation { writeTest { test } }
                query TestQuery { test }
              `
            }));

          expect(response.status).to.equal(200);
          expect(JSON.parse(response.text)).to.deep.equal({
            data: {
              test: 'Hello World'
            }
          });
        });
      });

      describe('With context', () => {
        it('Allows passing in a context', async () => {
          const config = [ urlString(), graphqlHTTP({
            schema: TestSchema,
            context: 'testValue'
          }) ];
          if (name === 'restify') {
            app.get(...config);
          } else {
            app.use(...config);
          }

          const response = await request(app)
            .get(urlString({
              operationName: 'TestQuery',
              query: `
                query TestQuery { context }
              `
            }));

          expect(response.status).to.equal(200);
          expect(JSON.parse(response.text)).to.deep.equal({
            data: {
              context: 'testValue'
            }
          });
        });

        it('Uses request as context by default', async () => {
          // Middleware that adds req.foo to every request
          app.use((req, res, next) => {
            req.foo = 'bar';
            next();
          });

          if (name === 'restify') {
            app.get(...basicConfig);
          } else {
            app.use(...basicConfig);
          }

          const response = await request(app)
            .get(urlString({
              operationName: 'TestQuery',
              query: `
                query TestQuery { contextDotFoo }
              `
            }));

          expect(response.status).to.equal(200);
          expect(JSON.parse(response.text)).to.deep.equal({
            data: {
              contextDotFoo: 'bar'
            }
          });
        });
      });

      describe('With options', () => {
        it('Allows returning an options Promise', async () => {
          const config = [ urlString(), graphqlHTTP(() => Promise.resolve({
            schema: TestSchema,
          })) ];
          if (name === 'restify') {
            app.get(...config);
          } else {
            app.use(...config);
          }

          const response = await request(app)
            .get(urlString({
              query: '{test}'
            }));

          expect(JSON.parse(response.text)).to.deep.equal({
            data: { test: 'Hello World' }
          });
        });

        it('Catches errors thrown from options function', async () => {
          const config = [ urlString(), graphqlHTTP(() => {
            throw new Error('I did something wrong');
          }) ];
          if (name === 'restify') {
            app.get(...config);
          } else {
            app.use(...config);
          }

          const response = await request(app)
            .get(urlString({
              query: '{test}'
            }));

          expect(response.status).to.equal(500);
          expect(JSON.parse(response.text)).to.deep.equal({
            errors: [ { message: 'I did something wrong' } ]
          });
        });
      });
    });

    describe('POST functionality', () => {
      describe('allows/supports', () => {
        beforeEach(() => {
          if (name === 'restify') {
            app.post(...basicConfig);
          } else {
            app.use(...basicConfig);
          }
        });

        it('POST with JSON encoding', async () => {
          const response = await request(app)
            .post(urlString()).send({ query: '{test}' });

          expect(JSON.parse(response.text)).to.deep.equal({
            data: { test: 'Hello World' }
          });
        });

        it('sending a mutation via POST', async () => {
          const response = await request(app)
            .post(urlString())
            .send({ query: 'mutation TestMutation { writeTest { test } }' });

          expect(response.status).to.equal(200);
          expect(JSON.parse(response.text)).to.deep.equal({
            data: { writeTest: { test: 'Hello World' } }
          });
        });

        it('POST with url encoding', async () => {
          const response = await request(app)
            .post(urlString())
            .send(stringify({ query: '{test}' }));

          expect(JSON.parse(response.text)).to.deep.equal({
            data: { test: 'Hello World' }
          });
        });

        it('POST JSON query with string variables', async () => {
          const response = await request(app)
            .post(urlString())
            .send({
              query: 'query helloWho($who: String){ test(who: $who) }',
              variables: JSON.stringify({ who: 'Dolly' })
            });

          expect(JSON.parse(response.text)).to.deep.equal({
            data: { test: 'Hello Dolly' }
          });
        });

        it('POST JSON query with JSON variables', async () => {
          const response = await request(app)
            .post(urlString())
            .send({
              query: 'query helloWho($who: String){ test(who: $who) }',
              variables: { who: 'Dolly' }
            });

          expect(JSON.parse(response.text)).to.deep.equal({
            data: { test: 'Hello Dolly' }
          });
        });

        it('POST url encoded query with string variables', async () => {
          const response = await request(app)
            .post(urlString())
            .send(stringify({
              query: 'query helloWho($who: String){ test(who: $who) }',
              variables: JSON.stringify({ who: 'Dolly' })
            }));

          expect(JSON.parse(response.text)).to.deep.equal({
            data: { test: 'Hello Dolly' }
          });
        });

        it('POST JSON query with GET variable values', async () => {
          const response = await request(app)
            .post(urlString({
              variables: JSON.stringify({ who: 'Dolly' })
            }))
            .send({ query: 'query helloWho($who: String){ test(who: $who) }' });

          expect(JSON.parse(response.text)).to.deep.equal({
            data: { test: 'Hello Dolly' }
          });
        });

        it('POST url encoded query with GET variable values', async () => {
          const response = await request(app)
            .post(urlString({
              variables: JSON.stringify({ who: 'Dolly' })
            }))
            .send(stringify({
              query: 'query helloWho($who: String){ test(who: $who) }'
            }));

          expect(JSON.parse(response.text)).to.deep.equal({
            data: { test: 'Hello Dolly' }
          });
        });

        it('POST raw text query with GET variable values', async () => {
          const response = await request(app)
            .post(urlString({
              variables: JSON.stringify({ who: 'Dolly' })
            }))
            .set('Content-Type', 'application/graphql')
            .send('query helloWho($who: String){ test(who: $who) }');

          expect(JSON.parse(response.text)).to.deep.equal({
            data: { test: 'Hello Dolly' }
          });
        });

        it('POST with operation name', async () => {
          const response = await request(app)
            .post(urlString())
            .send({
              query: `
                query helloYou { test(who: "You"), ...shared }
                query helloWorld { test(who: "World"), ...shared }
                query helloDolly { test(who: "Dolly"), ...shared }
                fragment shared on QueryRoot {
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

        it('POST with GET operation name', async () => {
          const response = await request(app)
            .post(urlString({
              operationName: 'helloWorld'
            }))
            .set('Content-Type', 'application/graphql')
            .send(`
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
            }
          });
        });

        it('other UTF charsets', async () => {
          const req = request(app)
            .post(urlString())
            .set('Content-Type', 'application/graphql; charset=utf-16');
          req.write(new Buffer('{ test(who: "World") }', 'utf16le'));
          const response = await req;

          expect(JSON.parse(response.text)).to.deep.equal({
            data: {
              test: 'Hello World'
            }
          });
        });

        it('gzipped POST bodies', async () => {
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
              test: 'Hello World'
            }
          });
        });

        it('deflated POST bodies', async () => {
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
              test: 'Hello World'
            }
          });
        });
      });

      describe('allows for pre-parsed POST', () => {
        it('bodies', async () => {
          // Note: this is not the only way to handle file uploads with GraphQL,
          // but it is terse and illustrative of using express-graphql and multer
          // together.

          // A simple schema which includes a mutation.
          const UploadedFileType = new GraphQLObjectType({
            name: 'UploadedFile',
            fields: {
              originalname: { type: GraphQLString },
              mimetype: { type: GraphQLString }
            }
          });

          const TestMutationSchema = new GraphQLSchema({
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

          // Multer provides multipart form data parsing.
          const storage = multer.memoryStorage();
          const multerHandler = multer({ storage }).single('file');
          const config = [ urlString(), graphqlHTTP(req => {
            return {
              schema: TestMutationSchema,
              rootValue: { request: req }
            };
          }) ];

          if (name === 'restify') {
            app.post(config[0], multerHandler, config[1]);
          } else {
            app.use(config[0], multerHandler);
            app.use(...config);
          }

          const response = await request(app)
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

        it('using application/graphql', async () => {
          app.use(bodyParser.text({ type: 'application/graphql' }));

          if (name === 'restify') {
            app.post(...basicConfig);
          } else {
            app.use(...basicConfig);
          }

          const req = request(app)
            .post(urlString())
            .set('Content-Type', 'application/graphql');
          req.write(new Buffer('{ test(who: "World") }'));
          const response = await req;

          expect(JSON.parse(response.text)).to.deep.equal({
            data: {
              test: 'Hello World'
            }
          });
        });
      });

      describe('does not accept unknown pre-parsed POST', () => {
        it('string', async () => {
          app.use(bodyParser.text({ type: '*/*' }));

          if (name === 'restify') {
            app.post(...basicConfig);
          } else {
            app.use(...basicConfig);
          }

          const req = request(app)
            .post(urlString());
          req.write(new Buffer('{ test(who: "World") }'));
          const response = await req;

          expect(response.status).to.equal(400);
          expect(JSON.parse(response.text)).to.deep.equal({
            errors: [ { message: 'Must provide query string.' } ]
          });
        });

        it('raw Buffer', async () => {
          app.use(bodyParser.raw({ type: '*/*' }));

          if (name === 'restify') {
            app.post(...basicConfig);
          } else {
            app.use(...basicConfig);
          }

          const req = request(app)
            .post(urlString())
            .set('Content-Type', 'application/graphql');
          req.write(new Buffer('{ test(who: "World") }'));
          const response = await req;

          expect(response.status).to.equal(400);
          expect(JSON.parse(response.text)).to.deep.equal({
            errors: [ { message: 'Must provide query string.' } ]
          });
        });
      });
    });

    describe('Response functionality', () => {
      it('uses send for express and restify', async () => {
        let spyEnd = {};
        let spySend = {};

        // mount a middleware to spy on response methods
        const config = [ urlString(), graphqlHTTP((req, res) => {
          spyEnd = sinon.spy(res, 'end');
          try {
            // res.send is undefined with connect
            spySend = sinon.spy(res, 'send');
          } catch (err) {
            spySend = undefined;
          }
          return { schema: TestSchema };
        }) ];
        if (name === 'restify') {
          app.get(...config);
        } else {
          app.use(...config);
        }

        await request(app).get(urlString({ query: '{test}' }));

        if (name === 'connect') {
          expect(spyEnd).to.have.been.called;
          expect(spySend).to.equal(undefined);
        } else {
          expect(spySend).to.have.been.called;
          expect(spyEnd).to.not.have.been.called;
        }
      });
    });

    it('will send request and response when using thunk', async () => {
      let hasRequest = false;
      let hasResponse = false;

      const config = [ urlString(), graphqlHTTP((req, res) => {
        if (req) {
          hasRequest = true;
        }
        if (res) {
          hasResponse = true;
        }
        return { schema: TestSchema };
      }) ];
      if (name === 'restify') {
        app.get(...config);
      } else {
        app.use(...config);
      }

      await request(app).get(urlString({ query: '{test}' }));

      expect(hasRequest).to.equal(true);
      expect(hasResponse).to.equal(true);
    });

    describe('Error handling functionality', () => {
      describe('GET handles', () => {
        beforeEach(() => {
          if (name === 'restify') {
            app.get(...basicConfig);
          } else {
            app.use(...basicConfig);
          }
        });

        it('field errors caught by GraphQL', async () => {
          const response = await request(app)
            .get(urlString({
              query: '{thrower}',
            }));

          expect(response.status).to.equal(200);
          expect(JSON.parse(response.text)).to.deep.equal({
            data: { thrower: null },
            errors: [ {
              message: 'Throws!',
              locations: [ { line: 1, column: 2 } ],
              path: [ 'thrower' ]
            } ]
          });
        });

        it('query errors from non-null top field errors', async () => {
          const response = await request(app)
            .get(urlString({
              query: '{nonNullThrower}',
            }));

          expect(response.status).to.equal(500);
          expect(JSON.parse(response.text)).to.deep.equal({
            data: null,
            errors: [ {
              message: 'Throws!',
              locations: [ { line: 1, column: 2 } ],
              path: [ 'nonNullThrower' ]
            } ]
          });
        });

        it('syntax errors caught by GraphQL', async () => {
          const response = await request(app)
            .get(urlString({
              query: 'syntaxerror',
            }));

          expect(response.status).to.equal(400);
          expect(JSON.parse(response.text)).to.deep.equal({
            errors: [ {
              message: 'Syntax Error GraphQL request (1:1) ' +
                'Unexpected Name "syntaxerror"\n\n1: syntaxerror\n   ^\n',
              locations: [ { line: 1, column: 1 } ]
            } ]
          });
        });

        it('errors caused by a lack of query', async () => {
          const response = await request(app).get(urlString());

          expect(response.status).to.equal(400);
          expect(JSON.parse(response.text)).to.deep.equal({
            errors: [ { message: 'Must provide query string.' } ]
          });
        });

        it('poorly formed variables', async () => {
          const response = await request(app)
            .get(urlString({
              variables: 'who:You',
              query: 'query helloWho($who: String){ test(who: $who) }'
            }));

          expect(response.status).to.equal(400);
          expect(JSON.parse(response.text)).to.deep.equal({
            errors: [ { message: 'Variables are invalid JSON.' } ]
          });
        });
      });

      describe('POST handles', () => {
        beforeEach(() => {
          if (name === 'restify') {
            app.post(...basicConfig);
          } else {
            app.use(...basicConfig);
          }
        });

        it('invalid JSON bodies', async () => {
          const response = await request(app)
            .post(urlString())
            .set('Content-Type', 'application/json')
            .send('[]');

          expect(response.status).to.equal(400);
          expect(JSON.parse(response.text)).to.deep.equal({
            errors: [ { message: 'POST body sent invalid JSON.' } ]
          });
        });

        it('incomplete JSON bodies', async () => {
          const response = await request(app)
            .post(urlString())
            .set('Content-Type', 'application/json')
            .send('{"query":');

          expect(response.status).to.equal(400);
          expect(JSON.parse(response.text)).to.deep.equal({
            errors: [ { message: 'POST body sent invalid JSON.' } ]
          });
        });

        it('plain POST text', async () => {
          const response = await request(app)
            .post(urlString({
              variables: JSON.stringify({ who: 'Dolly' })
            }))
            .set('Content-Type', 'text/plain')
            .send('query helloWho($who: String){ test(who: $who) }');

          expect(response.status).to.equal(400);
          expect(JSON.parse(response.text)).to.deep.equal({
            errors: [ { message: 'Must provide query string.' } ]
          });
        });

        it('unsupported charset', async () => {
          const response = await request(app)
            .post(urlString())
            .set('Content-Type', 'application/graphql; charset=ascii')
            .send('{ test(who: "World") }');

          expect(response.status).to.equal(415);
          expect(JSON.parse(response.text)).to.deep.equal({
            errors: [ { message: 'Unsupported charset "ASCII".' } ]
          });
        });

        it('unsupported utf charset', async () => {
          const response = await request(app)
            .post(urlString())
            .set('Content-Type', 'application/graphql; charset=utf-53')
            .send('{ test(who: "World") }');

          expect(response.status).to.equal(415);
          expect(JSON.parse(response.text)).to.deep.equal({
            errors: [ { message: 'Unsupported charset "UTF-53".' } ]
          });
        });

        it('unknown encoding', async () => {
          const response = await request(app)
            .post(urlString())
            .set('Content-Encoding', 'garbage')
            .send('!@#$%^*(&^$%#@');

          expect(response.status).to.equal(415);
          expect(JSON.parse(response.text)).to.deep.equal({
            errors: [ { message: 'Unsupported content-encoding "garbage".' } ]
          });
        });
      });

      describe('ALL handles', () => {
        it('unsupported HTTP methods', async function () {
          // this test doesn't apply to restify because you need
          // to define methods manually for each endpoint
          if (name === 'restify') {
            this.skip();
          }

          app.use(urlString(), graphqlHTTP({
            schema: TestSchema
          }));

          const response = await request(app)
            .put(urlString({ query: '{test}' }));

          expect(response.status).to.equal(405);
          expect(response.headers.allow).to.equal('GET, POST');
          expect(JSON.parse(response.text)).to.deep.equal({
            errors: [
              { message: 'GraphQL only supports GET and POST requests.' }
            ]
          });
        });
      });

      describe('allows for custom error formatting', () => {
        it('to sanitize', async () => {
          const config = [ urlString(), graphqlHTTP({
            schema: TestSchema,
            formatError(error) {
              return { message: 'Custom error format: ' + error.message };
            }
          }) ];
          if (name === 'restify') {
            app.get(...config);
          } else {
            app.use(...config);
          }

          const response = await request(app)
            .get(urlString({
              query: '{thrower}',
            }));

          expect(response.status).to.equal(200);
          expect(JSON.parse(response.text)).to.deep.equal({
            data: { thrower: null },
            errors: [ {
              message: 'Custom error format: Throws!',
            } ]
          });
        });

        it('to elaborate', async () => {
          const config = [ urlString(), graphqlHTTP({
            schema: TestSchema,
            formatError(error) {
              return {
                message: error.message,
                locations: error.locations,
                stack: 'Stack trace'
              };
            }
          }) ];
          if (name === 'restify') {
            app.get(...config);
          } else {
            app.use(...config);
          }

          const response = await request(app)
            .get(urlString({
              query: '{thrower}',
            }));

          expect(response.status).to.equal(200);
          expect(JSON.parse(response.text)).to.deep.equal({
            data: { thrower: null },
            errors: [ {
              message: 'Throws!',
              locations: [ { line: 1, column: 2 } ],
              stack: 'Stack trace',
            } ]
          });
        });
      });
    });

    describe('Built-in GraphiQL support', () => {
      describe('no opt-in', () => {
        it('does not renders GraphiQL if no opt-in', async () => {
          const config = [ urlString(), graphqlHTTP({
            schema: TestSchema,
            graphiql: false
          }) ];
          if (name === 'restify') {
            app.get(...config);
          } else {
            app.use(...config);
          }

          const response = await request(app)
            .get(urlString({ query: '{test}' }))
            .set('Accept', 'text/html');

          expect(response.status).to.equal(200);
          expect(response.type).to.equal('application/json');
          expect(JSON.parse(response.text)).to.deep.equal({
            data: { test: 'Hello World' }
          });
        });
      });

      describe('opt-in', () => {
        beforeEach(() => {
          const config = [ urlString(), graphqlHTTP({
            schema: TestSchema,
            graphiql: true
          }) ];
          if (name === 'restify') {
            app.get(...config);
          } else {
            app.use(...config);
          }
        });

        it('presents GraphiQL when accepting HTML', async () => {
          const response = await request(app)
            .get(urlString({ query: '{test}' }))
            .set('Accept', 'text/html');

          expect(response.status).to.equal(200);
          expect(response.type).to.equal('text/html');
          expect(response.text).to.include('{test}');
          expect(response.text).to.include('graphiql.min.js');
        });

        it('contains a pre-run response within GraphiQL', async () => {
          const response = await request(app)
            .get(urlString({ query: '{test}' }))
            .set('Accept', 'text/html');

          expect(response.status).to.equal(200);
          expect(response.type).to.equal('text/html');
          expect(response.text).to.include(
            'response: ' + JSON.stringify(
              JSON.stringify({ data: { test: 'Hello World' } }, null, 2)
            )
          );
        });

        it('contains a pre-run operation name within GraphiQL', async () => {
          const response = await request(app)
            .get(urlString({
              query: 'query A{a:test} query B{b:test}',
              operationName: 'B'
            }))
            .set('Accept', 'text/html');

          expect(response.status).to.equal(200);
          expect(response.type).to.equal('text/html');
          expect(response.text).to.include(
            'response: ' + JSON.stringify(
              JSON.stringify({ data: { b: 'Hello World' } }, null, 2)
            )
          );
          expect(response.text).to.include('operationName: "B"');
        });

        it('escapes HTML in queries within GraphiQL', async () => {
          const response = await request(app)
            .get(urlString({ query: '</script><script>alert(1)</script>' }))
            .set('Accept', 'text/html');

          expect(response.status).to.equal(400);
          expect(response.type).to.equal('text/html');
          expect(response.text).to.not.include('</script><script>alert(1)</script>');
        });

        it('escapes HTML in variables within GraphiQL', async () => {
          const response = await request(app).get(urlString({
            query: 'query helloWho($who: String) { test(who: $who) }',
            variables: JSON.stringify({
              who: '</script><script>alert(1)</script>'
            })
          })) .set('Accept', 'text/html');

          expect(response.status).to.equal(200);
          expect(response.type).to.equal('text/html');
          expect(response.text).to.not.include('</script><script>alert(1)</script>');
        });

        it('GraphiQL renders provided variables', async () => {
          const response = await request(app)
            .get(urlString({
              query: 'query helloWho($who: String) { test(who: $who) }',
              variables: JSON.stringify({ who: 'Dolly' })
            }))
            .set('Accept', 'text/html');

          expect(response.status).to.equal(200);
          expect(response.type).to.equal('text/html');
          expect(response.text).to.include(
            'variables: ' + JSON.stringify(
              JSON.stringify({ who: 'Dolly' }, null, 2)
            )
          );
        });

        it('GraphiQL accepts an empty query', async () => {
          const response = await request(app)
            .get(urlString())
            .set('Accept', 'text/html');

          expect(response.status).to.equal(200);
          expect(response.type).to.equal('text/html');
          expect(response.text).to.include('response: undefined');
        });

        it('GraphiQL accepts a mutation query - does not execute it', async () => {
          const response = await request(app)
            .get(urlString({
              query: 'mutation TestMutation { writeTest { test } }'
            }))
            .set('Accept', 'text/html');

          expect(response.status).to.equal(200);
          expect(response.type).to.equal('text/html');
          expect(response.text).to.include(
            'query: "mutation TestMutation { writeTest { test } }"'
          );
          expect(response.text).to.include('response: undefined');
        });

        it('returns HTML if preferred', async () => {
          const response = await request(app)
            .get(urlString({ query: '{test}' }))
            .set('Accept', 'text/html,application/json');

          expect(response.status).to.equal(200);
          expect(response.type).to.equal('text/html');
          expect(response.text).to.include('graphiql.min.js');
        });

        it('returns JSON if preferred', async () => {
          const response = await request(app)
            .get(urlString({ query: '{test}' }))
            .set('Accept', 'application/json,text/html');

          expect(response.status).to.equal(200);
          expect(response.type).to.equal('application/json');
          expect(JSON.parse(response.text)).to.deep.equal({
            data: { test: 'Hello World' }
          });
        });

        it('prefers JSON if unknown accept', async () => {
          const response = await request(app)
            .get(urlString({ query: '{test}' }))
            .set('Accept', 'unknown');

          expect(response.status).to.equal(200);
          expect(response.type).to.equal('application/json');
          expect(JSON.parse(response.text)).to.deep.equal({
            data: { test: 'Hello World' }
          });
        });

        it('prefers JSON if explicitly requested raw response', async () => {
          const response = await request(app)
            .get(urlString({ query: '{test}', raw: '' }))
            .set('Accept', 'text/html');

          expect(response.status).to.equal(200);
          expect(response.type).to.equal('application/json');
          expect(JSON.parse(response.text)).to.deep.equal({
            data: { test: 'Hello World' }
          });
        });
      });
    });

    describe('Custom validation rules', () => {
      const AlwaysInvalidRule = function (context) {
        return {
          enter() {
            context.reportError(new GraphQLError(
              'AlwaysInvalidRule was really invalid!'
            ));
            return BREAK;
          }
        };
      };

      it('Do not execute a query if it do not pass the custom validation.', async() => {
        const config = [ urlString(), graphqlHTTP({
          schema: TestSchema,
          validationRules: [ AlwaysInvalidRule ]
        }) ];
        if (name === 'restify') {
          app.get(...config);
        } else {
          app.use(...config);
        }

        const response = await request(app)
          .get(urlString({
            query: '{thrower}',
          }));

        expect(response.status).to.equal(400);
        expect(JSON.parse(response.text)).to.deep.equal({
          errors: [
            {
              message: 'AlwaysInvalidRule was really invalid!'
            },
          ]
        });

      });
    });

    describe('Custom result extensions', () => {
      it('allows for adding extensions', async () => {
        const config = [ urlString(), graphqlHTTP(() => {
          const startTime = 1000000000; /* Date.now(); */
          return {
            schema: TestSchema,
            extensions() {
              return { runTime: 1000000010 /* Date.now() */ - startTime };
            }
          };
        }) ];
        if (name === 'restify') {
          app.get(...config);
        } else {
          app.use(...config);
        }

        const response = await request(app)
          .get(urlString({ query: '{test}', raw: '' }))
          .set('Accept', 'text/html');

        expect(response.status).to.equal(200);
        expect(response.type).to.equal('application/json');
        expect(JSON.parse(response.text)).to.deep.equal({
          data: { test: 'Hello World' },
          extensions: { runTime: 10 }
        });
      });

      it('extensions have access to initial GraphQL result', async () => {
        const config = [ urlString(), graphqlHTTP({
          schema: TestSchema,
          formatError: () => null,
          extensions({ result }) {
            return { preservedErrors: (result: any).errors };
          }
        }) ];
        if (name === 'restify') {
          app.get(...config);
        } else {
          app.use(...config);
        }

        const response = await request(app)
          .get(urlString({
            query: '{thrower}',
          }));

        expect(response.status).to.equal(200);
        expect(JSON.parse(response.text)).to.deep.equal({
          data: { thrower: null },
          errors: [ null ],
          extensions: {
            preservedErrors: [ {
              message: 'Throws!',
              locations: [ { line: 1, column: 2 } ],
              path: [ 'thrower' ]
            } ]
          }
        });
      });

      it('extension function may be async', async () => {
        const config = [ urlString(), graphqlHTTP({
          schema: TestSchema,
          async extensions() {
            // Note: you can await arbitrary things here!
            return { eventually: 42 };
          }
        }) ];
        if (name === 'restify') {
          app.get(...config);
        } else {
          app.use(...config);
        }

        const response = await request(app)
          .get(urlString({ query: '{test}', raw: '' }))
          .set('Accept', 'text/html');

        expect(response.status).to.equal(200);
        expect(response.type).to.equal('application/json');
        expect(JSON.parse(response.text)).to.deep.equal({
          data: { test: 'Hello World' },
          extensions: { eventually: 42 }
        });
      });
    });

    describe('AST caches for query string', () => {
      it('AST for query string should be cached', async () => {
        const cachedMap = new LRUMap(10);
        const config = [ urlString(), graphqlHTTP({
          schema: TestSchema,
          astCacheMap: cachedMap,
        }) ];
        if (name === 'restify') {
          app.get(...config);
        } else {
          app.use(...config);
        }

        const response = await request(app)
          .get(urlString({
            query: '{test}'
          }));

        expect(JSON.parse(response.text)).to.deep.equal({
          data: { test: 'Hello World' }
        });

        expect(cachedMap.size).to.equal(1);
      });
    });
  });
});
