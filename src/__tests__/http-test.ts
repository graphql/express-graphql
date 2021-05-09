import zlib from 'zlib';

import type { Server as Restify } from 'restify';
import connect from 'connect';
import express from 'express';
import supertest from 'supertest';
import bodyParser from 'body-parser';

import type { ASTVisitor, ValidationContext } from 'graphql';
import sinon from 'sinon';
import multer from 'multer'; // cSpell:words mimetype originalname
import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
  Source,
  GraphQLError,
  GraphQLString,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  parse,
  execute,
  validate,
  buildSchema,
} from 'graphql';

import { graphqlHTTP } from '../index';

type Middleware = (req: any, res: any, next: () => void) => unknown;
type Server = () => {
  request: () => supertest.SuperTest<supertest.Test>;
  use: (middleware: Middleware) => unknown;
  get: (path: string, middleware: Middleware) => unknown;
  post: (path: string, middleware: Middleware) => unknown;
  put: (path: string, middleware: Middleware) => unknown;
};

const QueryRootType = new GraphQLObjectType({
  name: 'QueryRoot',
  fields: {
    test: {
      type: GraphQLString,
      args: {
        who: { type: GraphQLString },
      },
      resolve: (_root, args: { who?: string }) =>
        'Hello ' + (args.who ?? 'World'),
    },
    thrower: {
      type: GraphQLString,
      resolve() {
        throw new Error('Throws!');
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

function stringifyURLParams(urlParams?: { [param: string]: string }): string {
  return new URLSearchParams(urlParams).toString();
}

function urlString(urlParams?: { [param: string]: string }): string {
  let string = '/graphql';
  if (urlParams) {
    string += '?' + stringifyURLParams(urlParams);
  }
  return string;
}

describe('GraphQL-HTTP tests for connect', () => {
  runTests(() => {
    const app = connect();

    /* istanbul ignore next Error handler added only for debugging failed tests */
    app.on('error', (error) => {
      // eslint-disable-next-line no-console
      console.warn('App encountered an error:', error);
    });

    return {
      request: () => supertest(app),
      use: app.use.bind(app),
      // Connect only likes using app.use.
      get: app.use.bind(app),
      put: app.use.bind(app),
      post: app.use.bind(app),
    };
  });
});

describe('GraphQL-HTTP tests for express', () => {
  runTests(() => {
    const app = express();

    // This ensures consistent tests, as express defaults json spacing to 0 only in "production" mode.
    app.set('json spaces', 0);

    /* istanbul ignore next Error handler added only for debugging failed tests */
    app.on('error', (error) => {
      // eslint-disable-next-line no-console
      console.warn('App encountered an error:', error);
    });

    return {
      request: () => supertest(app),
      use: app.use.bind(app),
      get: app.get.bind(app),
      put: app.put.bind(app),
      post: app.post.bind(app),
    };
  });
});

describe('GraphQL-HTTP tests for restify', () => {
  runTests(() => {
    // We're lazily loading the restify module so as to avoid issues caused by it patching the
    // native IncomingMessage and ServerResponse classes. See https://github.com/restify/node-restify/issues/1540
    // Using require instead of import here to avoid using Promises.
    // eslint-disable-next-line @typescript-eslint/no-var-requires,@typescript-eslint/no-require-imports,node/global-require
    const restify = require('restify');
    const app: Restify = restify.createServer();

    /* istanbul ignore next Error handler added only for debugging failed tests */
    app.on('error', (error) => {
      // eslint-disable-next-line no-console
      console.warn('App encountered an error:', error);
    });

    return {
      request: () => supertest(app),
      use: app.use.bind(app),
      get: app.get.bind(app),
      put: app.put.bind(app),
      post: app.post.bind(app),
    };
  });
});

function runTests(server: Server) {
  describe('GET functionality', () => {
    it('allows GET with query param', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
        }),
      );

      const response = await app.request().get(
        urlString({
          query: '{ test }',
        }),
      );

      expect(response.text).to.equal('{"data":{"test":"Hello World"}}');
    });

    it('allows GET with variable values', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
        }),
      );

      const response = await app.request().get(
        urlString({
          query: 'query helloWho($who: String){ test(who: $who) }',
          variables: JSON.stringify({ who: 'Dolly' }),
        }),
      );

      expect(response.text).to.equal('{"data":{"test":"Hello Dolly"}}');
    });

    it('allows GET with operation name', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP(() => ({
          schema: TestSchema,
        })),
      );

      const response = await app.request().get(
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

    it('reports validation errors', async () => {
      const app = server();

      app.get(urlString(), graphqlHTTP({ schema: TestSchema }));

      const response = await app.request().get(
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

    it('errors when missing operation name', async () => {
      const app = server();

      app.get(urlString(), graphqlHTTP({ schema: TestSchema }));

      const response = await app.request().get(
        urlString({
          query: `
            query TestQuery { test }
            mutation TestMutation { writeTest { test } }
          `,
        }),
      );

      expect(response.status).to.equal(500);
      expect(JSON.parse(response.text)).to.deep.equal({
        errors: [
          {
            message:
              'Must provide operation name if query contains multiple operations.',
          },
        ],
      });
    });

    it('errors when sending a mutation via GET', async () => {
      const app = server();

      app.get(urlString(), graphqlHTTP({ schema: TestSchema }));

      const response = await app.request().get(
        urlString({
          query: 'mutation TestMutation { writeTest { test } }',
        }),
      );

      expect(response.status).to.equal(405);
      expect(JSON.parse(response.text)).to.deep.equal({
        errors: [
          {
            message:
              'Can only perform a mutation operation from a POST request.',
          },
        ],
      });
    });

    it('errors when selecting a mutation within a GET', async () => {
      const app = server();

      app.get(urlString(), graphqlHTTP({ schema: TestSchema }));

      const response = await app.request().get(
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
            message:
              'Can only perform a mutation operation from a POST request.',
          },
        ],
      });
    });

    it('allows a mutation to exist within a GET', async () => {
      const app = server();

      app.get(urlString(), graphqlHTTP({ schema: TestSchema }));

      const response = await app.request().get(
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

    it('allows async resolvers', async () => {
      const schema = new GraphQLSchema({
        query: new GraphQLObjectType({
          name: 'Query',
          fields: {
            foo: {
              type: GraphQLString,
              resolve: () => Promise.resolve('bar'),
            },
          },
        }),
      });
      const app = server();

      app.get(urlString(), graphqlHTTP({ schema }));

      const response = await app.request().get(
        urlString({
          query: '{ foo }',
        }),
      );

      expect(response.status).to.equal(200);
      expect(JSON.parse(response.text)).to.deep.equal({
        data: { foo: 'bar' },
      });
    });

    it('allows passing in a context', async () => {
      const schema = new GraphQLSchema({
        query: new GraphQLObjectType({
          name: 'Query',
          fields: {
            test: {
              type: GraphQLString,
              resolve: (_obj, _args, context) => context,
            },
          },
        }),
      });
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema,
          context: 'testValue',
        }),
      );

      const response = await app.request().get(
        urlString({
          query: '{ test }',
        }),
      );

      expect(response.status).to.equal(200);
      expect(JSON.parse(response.text)).to.deep.equal({
        data: {
          test: 'testValue',
        },
      });
    });

    it('allows passing in a fieldResolver', async () => {
      const schema = buildSchema(`
        type Query {
          test: String
        }
      `);
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema,
          fieldResolver: () => 'fieldResolver data',
        }),
      );

      const response = await app.request().get(
        urlString({
          query: '{ test }',
        }),
      );

      expect(response.status).to.equal(200);
      expect(JSON.parse(response.text)).to.deep.equal({
        data: {
          test: 'fieldResolver data',
        },
      });
    });

    it('allows passing in a typeResolver', async () => {
      const schema = buildSchema(`
        type Foo {
          foo: String
        }

        type Bar {
          bar: String
        }

        union UnionType = Foo | Bar

        type Query {
          test: UnionType
        }
      `);
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema,
          rootValue: { test: {} },
          typeResolver: () => 'Bar',
        }),
      );

      const response = await app.request().get(
        urlString({
          query: '{ test { __typename } }',
        }),
      );

      expect(response.status).to.equal(200);
      expect(JSON.parse(response.text)).to.deep.equal({
        data: {
          test: { __typename: 'Bar' },
        },
      });
    });

    it('uses request as context by default', async () => {
      const schema = new GraphQLSchema({
        query: new GraphQLObjectType({
          name: 'Query',
          fields: {
            test: {
              type: GraphQLString,
              resolve: (_obj, _args, context) => context.foo,
            },
          },
        }),
      });
      const app = server();

      // Middleware that adds req.foo to every request
      app.use((req, _res, next) => {
        req.foo = 'bar';
        next();
      });

      app.get(urlString(), graphqlHTTP({ schema }));

      const response = await app.request().get(
        urlString({
          query: '{ test }',
        }),
      );

      expect(response.status).to.equal(200);
      expect(JSON.parse(response.text)).to.deep.equal({
        data: {
          test: 'bar',
        },
      });
    });

    it('allows returning an options Promise', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP(() =>
          Promise.resolve({
            schema: TestSchema,
          }),
        ),
      );

      const response = await app.request().get(
        urlString({
          query: '{ test }',
        }),
      );

      expect(response.text).to.equal('{"data":{"test":"Hello World"}}');
    });

    it('provides an options function with arguments', async () => {
      const app = server();

      let seenRequest;
      let seenResponse;
      let seenParams;

      app.get(
        urlString(),
        graphqlHTTP((req, res, params) => {
          seenRequest = req;
          seenResponse = res;
          seenParams = params;
          return { schema: TestSchema };
        }),
      );

      const response = await app.request().get(
        urlString({
          query: '{ test }',
        }),
      );

      expect(response.text).to.equal('{"data":{"test":"Hello World"}}');

      expect(seenRequest).to.not.equal(undefined);
      expect(seenResponse).to.not.equal(undefined);
      expect(seenParams).to.deep.equal({
        query: '{ test }',
        operationName: null,
        variables: null,
        raw: false,
      });
    });

    it('catches errors thrown from options function', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP(() => {
          throw new Error('I did something wrong');
        }),
      );

      const response = await app.request().get(
        urlString({
          query: '{ test }',
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

      app.post(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
        }),
      );

      const response = await app
        .request()
        .post(urlString())
        .send({ query: '{ test }' });

      expect(response.text).to.equal('{"data":{"test":"Hello World"}}');
    });

    it('allows sending a mutation via POST', async () => {
      const app = server();

      app.post(urlString(), graphqlHTTP({ schema: TestSchema }));

      const response = await app
        .request()
        .post(urlString())
        .send({ query: 'mutation TestMutation { writeTest { test } }' });

      expect(response.status).to.equal(200);
      expect(response.text).to.equal(
        '{"data":{"writeTest":{"test":"Hello World"}}}',
      );
    });

    it('allows POST with url encoding', async () => {
      const app = server();

      app.post(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
        }),
      );

      const response = await app
        .request()
        .post(urlString())
        .send(stringifyURLParams({ query: '{ test }' }));

      expect(response.text).to.equal('{"data":{"test":"Hello World"}}');
    });

    it('supports POST JSON query with string variables', async () => {
      const app = server();

      app.post(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
        }),
      );

      const response = await app
        .request()
        .post(urlString())
        .send({
          query: 'query helloWho($who: String){ test(who: $who) }',
          variables: JSON.stringify({ who: 'Dolly' }),
        });

      expect(response.text).to.equal('{"data":{"test":"Hello Dolly"}}');
    });

    it('supports POST JSON query with JSON variables', async () => {
      const app = server();

      app.post(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
        }),
      );

      const response = await app
        .request()
        .post(urlString())
        .send({
          query: 'query helloWho($who: String){ test(who: $who) }',
          variables: { who: 'Dolly' },
        });

      expect(response.text).to.equal('{"data":{"test":"Hello Dolly"}}');
    });

    it('supports POST url encoded query with string variables', async () => {
      const app = server();

      app.post(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
        }),
      );

      const response = await app
        .request()
        .post(urlString())
        .send(
          stringifyURLParams({
            query: 'query helloWho($who: String){ test(who: $who) }',
            variables: JSON.stringify({ who: 'Dolly' }),
          }),
        );

      expect(response.text).to.equal('{"data":{"test":"Hello Dolly"}}');
    });

    it('supports POST JSON query with GET variable values', async () => {
      const app = server();

      app.post(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
        }),
      );

      const response = await app
        .request()
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

      app.post(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
        }),
      );

      const response = await app
        .request()
        .post(
          urlString({
            variables: JSON.stringify({ who: 'Dolly' }),
          }),
        )
        .send(
          stringifyURLParams({
            query: 'query helloWho($who: String){ test(who: $who) }',
          }),
        );

      expect(response.text).to.equal('{"data":{"test":"Hello Dolly"}}');
    });

    it('supports POST raw text query with GET variable values', async () => {
      const app = server();

      app.post(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
        }),
      );

      const response = await app
        .request()
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

      app.post(
        urlString(),
        graphqlHTTP(() => ({
          schema: TestSchema,
        })),
      );

      const response = await app.request().post(urlString()).send({
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

      app.post(
        urlString(),
        graphqlHTTP(() => ({
          schema: TestSchema,
        })),
      );

      const response = await app
        .request()
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

      app.post(
        urlString(),
        graphqlHTTP(() => ({
          schema: TestSchema,
        })),
      );

      const req = app
        .request()
        .post(urlString())
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'gzip');

      req.write(zlib.gzipSync('{ "query": "{ test }" }'));

      const response = await req;
      expect(JSON.parse(response.text)).to.deep.equal({
        data: {
          test: 'Hello World',
        },
      });
    });

    it('allows deflated POST bodies', async () => {
      const app = server();

      app.post(
        urlString(),
        graphqlHTTP(() => ({
          schema: TestSchema,
        })),
      );

      const req = app
        .request()
        .post(urlString())
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'deflate');

      req.write(zlib.deflateSync('{ "query": "{ test }" }'));

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
      app.post(
        urlString(),
        graphqlHTTP((req) => ({
          schema: TestMutationSchema,
          rootValue: { request: req },
        })),
      );

      const response = await app
        .request()
        .post(urlString())
        .field(
          'query',
          `mutation TestMutation {
            uploadFile { originalname, mimetype }
          }`,
        )
        .attach('file', Buffer.from('test'), 'test.txt');

      expect(JSON.parse(response.text)).to.deep.equal({
        data: {
          uploadFile: {
            originalname: 'test.txt',
            mimetype: 'text/plain',
          },
        },
      });
    });

    it('allows for pre-parsed POST using application/graphql', async () => {
      const app = server();
      app.use(bodyParser.text({ type: 'application/graphql' }));

      app.post(urlString(), graphqlHTTP({ schema: TestSchema }));

      const req = app
        .request()
        .post(urlString())
        .set('Content-Type', 'application/graphql');
      req.write(Buffer.from('{ test(who: "World") }'));
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

      app.post(urlString(), graphqlHTTP({ schema: TestSchema }));

      const req = app.request().post(urlString());
      req.write(Buffer.from('{ test(who: "World") }'));
      const response = await req;

      expect(response.status).to.equal(400);
      expect(JSON.parse(response.text)).to.deep.equal({
        errors: [{ message: 'Must provide query string.' }],
      });
    });

    it('does not accept unknown pre-parsed POST raw Buffer', async () => {
      const app = server();
      app.use(bodyParser.raw({ type: '*/*' }));

      app.post(urlString(), graphqlHTTP({ schema: TestSchema }));

      const req = app
        .request()
        .post(urlString())
        .set('Content-Type', 'application/graphql');
      req.write(Buffer.from('{ test(who: "World") }'));
      const response = await req;

      expect(response.status).to.equal(400);
      expect(JSON.parse(response.text)).to.deep.equal({
        errors: [{ message: 'Must provide query string.' }],
      });
    });
  });

  describe('Pretty printing', () => {
    it('supports pretty printing', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          pretty: true,
        }),
      );

      const response = await app.request().get(
        urlString({
          query: '{ test }',
        }),
      );

      expect(response.text).to.equal(
        [
          // Pretty printed JSON
          '{',
          '  "data": {',
          '    "test": "Hello World"',
          '  }',
          '}',
        ].join('\n'),
      );
    });

    it('supports pretty printing configured by request', async () => {
      const app = server();
      let pretty: boolean | undefined;

      app.get(
        urlString(),
        graphqlHTTP(() => ({
          schema: TestSchema,
          pretty,
        })),
      );

      pretty = undefined;
      const defaultResponse = await app.request().get(
        urlString({
          query: '{ test }',
        }),
      );

      expect(defaultResponse.text).to.equal('{"data":{"test":"Hello World"}}');

      pretty = true;
      const prettyResponse = await app.request().get(
        urlString({
          query: '{ test }',
          pretty: '1',
        }),
      );

      expect(prettyResponse.text).to.equal(
        [
          // Pretty printed JSON
          '{',
          '  "data": {',
          '    "test": "Hello World"',
          '  }',
          '}',
        ].join('\n'),
      );

      pretty = false;
      const unprettyResponse = await app.request().get(
        urlString({
          query: '{ test }',
          pretty: '0',
        }),
      );

      expect(unprettyResponse.text).to.equal('{"data":{"test":"Hello World"}}');
    });
  });

  it('will send request and response when using thunk', async () => {
    const app = server();

    let seenRequest;
    let seenResponse;

    app.get(
      urlString(),
      graphqlHTTP((req, res) => {
        seenRequest = req;
        seenResponse = res;
        return { schema: TestSchema };
      }),
    );

    await app.request().get(urlString({ query: '{ test }' }));

    expect(seenRequest).to.not.equal(undefined);
    expect(seenResponse).to.not.equal(undefined);
  });

  describe('Error handling functionality', () => {
    it('handles field errors caught by GraphQL', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
        }),
      );

      const response = await app.request().get(
        urlString({
          query: '{ thrower }',
        }),
      );

      expect(response.status).to.equal(200);
      expect(JSON.parse(response.text)).to.deep.equal({
        data: { thrower: null },
        errors: [
          {
            message: 'Throws!',
            locations: [{ line: 1, column: 3 }],
            path: ['thrower'],
          },
        ],
      });
    });

    it('handles query errors from non-null top field errors', async () => {
      const schema = new GraphQLSchema({
        query: new GraphQLObjectType({
          name: 'Query',
          fields: {
            test: {
              type: new GraphQLNonNull(GraphQLString),
              resolve() {
                throw new Error('Throws!');
              },
            },
          },
        }),
      });
      const app = server();

      app.get(urlString(), graphqlHTTP({ schema }));

      const response = await app.request().get(
        urlString({
          query: '{ test }',
        }),
      );

      expect(response.status).to.equal(500);
      expect(JSON.parse(response.text)).to.deep.equal({
        data: null,
        errors: [
          {
            message: 'Throws!',
            locations: [{ line: 1, column: 3 }],
            path: ['test'],
          },
        ],
      });
    });

    it('allows for custom error formatting to sanitize GraphQL errors', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          customFormatErrorFn(error) {
            return {
              message:
                `Custom ${error.constructor.name} format: ` + error.message,
            };
          },
        }),
      );

      const response = await app.request().get(
        urlString({
          query: '{ thrower }',
        }),
      );

      expect(response.status).to.equal(200);
      expect(JSON.parse(response.text)).to.deep.equal({
        data: { thrower: null },
        errors: [
          {
            message: 'Custom GraphQLError format: Throws!',
          },
        ],
      });
    });

    it('allows for custom error formatting to sanitize HTTP errors', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          customFormatErrorFn(error) {
            return {
              message:
                `Custom ${error.constructor.name} format: ` + error.message,
            };
          },
        }),
      );

      const response = await app.request().get(urlString());

      expect(response.status).to.equal(400);
      expect(JSON.parse(response.text)).to.deep.equal({
        errors: [
          {
            message: 'Custom GraphQLError format: Must provide query string.',
          },
        ],
      });
    });

    it('allows for custom error formatting to elaborate', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          customFormatErrorFn(error) {
            return {
              message: error.message,
              locations: error.locations,
              stack: 'Stack trace',
            };
          },
        }),
      );

      const response = await app.request().get(
        urlString({
          query: '{ thrower }',
        }),
      );

      expect(response.status).to.equal(200);
      expect(JSON.parse(response.text)).to.deep.equal({
        data: { thrower: null },
        errors: [
          {
            message: 'Throws!',
            locations: [{ line: 1, column: 3 }],
            stack: 'Stack trace',
          },
        ],
      });
    });

    it('handles syntax errors caught by GraphQL', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
        }),
      );

      const response = await app.request().get(
        urlString({
          query: 'syntax_error',
        }),
      );

      expect(response.status).to.equal(400);
      expect(JSON.parse(response.text)).to.deep.equal({
        errors: [
          {
            message: 'Syntax Error: Unexpected Name "syntax_error".',
            locations: [{ line: 1, column: 1 }],
          },
        ],
      });
    });

    it('handles errors caused by a lack of query', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
        }),
      );

      const response = await app.request().get(urlString());

      expect(response.status).to.equal(400);
      expect(JSON.parse(response.text)).to.deep.equal({
        errors: [{ message: 'Must provide query string.' }],
      });
    });

    it('handles invalid JSON bodies', async () => {
      const app = server();

      app.post(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
        }),
      );

      const response = await app
        .request()
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

      app.post(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
        }),
      );

      const response = await app
        .request()
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

      app.post(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
        }),
      );

      const response = await app
        .request()
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

      app.post(
        urlString(),
        graphqlHTTP(() => ({
          schema: TestSchema,
        })),
      );

      const response = await app
        .request()
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

      app.post(
        urlString(),
        graphqlHTTP(() => ({
          schema: TestSchema,
        })),
      );

      const response = await app
        .request()
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

      app.post(
        urlString(),
        graphqlHTTP(() => ({
          schema: TestSchema,
        })),
      );

      const response = await app
        .request()
        .post(urlString())
        .set('Content-Encoding', 'garbage')
        .send('!@#$%^*(&^$%#@');

      expect(response.status).to.equal(415);
      expect(JSON.parse(response.text)).to.deep.equal({
        errors: [{ message: 'Unsupported content-encoding "garbage".' }],
      });
    });

    it('handles invalid body', async () => {
      const app = server();

      app.post(
        urlString(),
        graphqlHTTP(() => ({
          schema: TestSchema,
        })),
      );

      const response = await app
        .request()
        .post(urlString())
        .set('Content-Type', 'application/json')
        .send(`{ "query": "{ ${new Array(102400).fill('test').join('')} }" }`);

      expect(response.status).to.equal(413);
      expect(JSON.parse(response.text)).to.deep.equal({
        errors: [{ message: 'Invalid body: request entity too large.' }],
      });
    });

    it('handles poorly formed variables', async () => {
      const app = server();

      app.get(urlString(), graphqlHTTP({ schema: TestSchema }));

      const response = await app.request().get(
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

    it('`formatError` is deprecated', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          formatError(error) {
            return { message: 'Custom error format: ' + error.message };
          },
        }),
      );

      const spy = sinon.spy(console, 'warn');

      const response = await app.request().get(
        urlString({
          variables: 'who:You',
          query: 'query helloWho($who: String){ test(who: $who) }',
        }),
      );

      expect(
        spy.calledWith(
          '`formatError` is deprecated and replaced by `customFormatErrorFn`. It will be removed in version 1.0.0.',
        ),
      );
      expect(response.status).to.equal(400);
      expect(JSON.parse(response.text)).to.deep.equal({
        errors: [
          {
            message: 'Custom error format: Variables are invalid JSON.',
          },
        ],
      });

      spy.restore();
    });

    it('allows for custom error formatting of poorly formed requests', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          customFormatErrorFn(error) {
            return { message: 'Custom error format: ' + error.message };
          },
        }),
      );

      const response = await app.request().get(
        urlString({
          variables: 'who:You',
          query: 'query helloWho($who: String){ test(who: $who) }',
        }),
      );

      expect(response.status).to.equal(400);
      expect(JSON.parse(response.text)).to.deep.equal({
        errors: [
          {
            message: 'Custom error format: Variables are invalid JSON.',
          },
        ],
      });
    });

    it('allows disabling prettifying poorly formed requests', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          pretty: false,
        }),
      );

      const response = await app.request().get(
        urlString({
          variables: 'who:You',
          query: 'query helloWho($who: String){ test(who: $who) }',
        }),
      );

      expect(response.status).to.equal(400);
      expect(response.text).to.equal(
        '{"errors":[{"message":"Variables are invalid JSON."}]}',
      );
    });

    it('handles invalid variables', async () => {
      const app = server();

      app.post(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
        }),
      );

      const response = await app
        .request()
        .post(urlString())
        .send({
          query: 'query helloWho($who: String){ test(who: $who) }',
          variables: { who: ['John', 'Jane'] },
        });

      expect(response.status).to.equal(500);
      expect(JSON.parse(response.text)).to.deep.equal({
        errors: [
          {
            locations: [{ column: 16, line: 1 }],
            message:
              'Variable "$who" got invalid value ["John", "Jane"]; String cannot represent a non string value: ["John", "Jane"]',
          },
        ],
      });
    });

    it('handles unsupported HTTP methods', async () => {
      const app = server();

      app.put(urlString(), graphqlHTTP({ schema: TestSchema }));

      const response = await app
        .request()
        .put(urlString({ query: '{ test }' }));

      expect(response.status).to.equal(405);
      expect(response.get('allow')).to.equal('GET, POST');
      expect(JSON.parse(response.text)).to.deep.equal({
        errors: [{ message: 'GraphQL only supports GET and POST requests.' }],
      });
    });
  });

  describe('Built-in GraphiQL support', () => {
    it('does not render GraphiQL if no opt-in', async () => {
      const app = server();

      app.get(urlString(), graphqlHTTP({ schema: TestSchema }));

      const response = await app
        .request()
        .get(urlString({ query: '{ test }' }))
        .set('Accept', 'text/html');

      expect(response.status).to.equal(200);
      expect(response.type).to.equal('application/json');
      expect(response.text).to.equal('{"data":{"test":"Hello World"}}');
    });

    it('presents GraphiQL when accepting HTML', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          graphiql: true,
        }),
      );

      const response = await app
        .request()
        .get(urlString({ query: '{ test }' }))
        .set('Accept', 'text/html');

      expect(response.status).to.equal(200);
      expect(response.type).to.equal('text/html');
      expect(response.text).to.include('{ test }');
      expect(response.text).to.include('graphiql.min.js');
    });

    it('contains a default query within GraphiQL', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          graphiql: { defaultQuery: 'query testDefaultQuery { hello }' },
        }),
      );

      const response = await app
        .request()
        .get(urlString())
        .set('Accept', 'text/html');

      expect(response.status).to.equal(200);
      expect(response.type).to.equal('text/html');
      expect(response.text).to.include(
        'defaultQuery: "query testDefaultQuery { hello }"',
      );
    });

    it('contains a pre-run response within GraphiQL', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          graphiql: true,
        }),
      );

      const response = await app
        .request()
        .get(urlString({ query: '{ test }' }))
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

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          graphiql: true,
        }),
      );

      const response = await app
        .request()
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

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          graphiql: true,
        }),
      );

      const response = await app
        .request()
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

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          graphiql: true,
        }),
      );

      const response = await app
        .request()
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

    it('renders provided variables within GraphiQL', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          graphiql: true,
        }),
      );

      const response = await app
        .request()
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

    it('accepts an empty query when rendering GraphiQL', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          graphiql: true,
        }),
      );

      const response = await app
        .request()
        .get(urlString())
        .set('Accept', 'text/html');

      expect(response.status).to.equal(200);
      expect(response.type).to.equal('text/html');
      expect(response.text).to.include('response: undefined');
    });

    it('accepts a mutation query when rendering GraphiQL - does not execute it', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          graphiql: true,
        }),
      );

      const response = await app
        .request()
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

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          graphiql: true,
        }),
      );

      const response = await app
        .request()
        .get(urlString({ query: '{ test }' }))
        .set('Accept', 'text/html,application/json');

      expect(response.status).to.equal(200);
      expect(response.type).to.equal('text/html');
      expect(response.text).to.include('graphiql.min.js');
    });

    it('returns JSON if preferred', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          graphiql: true,
        }),
      );

      const response = await app
        .request()
        .get(urlString({ query: '{ test }' }))
        .set('Accept', 'application/json,text/html');

      expect(response.status).to.equal(200);
      expect(response.type).to.equal('application/json');
      expect(response.text).to.equal('{"data":{"test":"Hello World"}}');
    });

    it('prefers JSON if unknown accept', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          graphiql: true,
        }),
      );

      const response = await app
        .request()
        .get(urlString({ query: '{ test }' }))
        .set('Accept', 'unknown');

      expect(response.status).to.equal(200);
      expect(response.type).to.equal('application/json');
      expect(response.text).to.equal('{"data":{"test":"Hello World"}}');
    });

    it('prefers JSON if explicitly requested raw response', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          graphiql: true,
        }),
      );

      const response = await app
        .request()
        .get(urlString({ query: '{ test }', raw: '' }))
        .set('Accept', 'text/html');

      expect(response.status).to.equal(200);
      expect(response.type).to.equal('application/json');
      expect(response.text).to.equal('{"data":{"test":"Hello World"}}');
    });

    it('contains subscriptionEndpoint within GraphiQL', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          graphiql: { subscriptionEndpoint: 'ws://localhost' },
        }),
      );

      const response = await app
        .request()
        .get(urlString())
        .set('Accept', 'text/html');

      expect(response.status).to.equal(200);
      expect(response.type).to.equal('text/html');
      // should contain the function to make fetcher for subscription or non-subscription
      expect(response.text).to.include('makeFetcher');
      // should contain subscriptions-transport-ws browser client
      expect(response.text).to.include('SubscriptionsTransportWs');

      // should contain the subscriptionEndpoint url
      expect(response.text).to.include('ws:\\/\\/localhost');
    });

    it('contains subscriptionEndpoint within GraphiQL with websocketClient option', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          graphiql: {
            subscriptionEndpoint: 'ws://localhost',
            websocketClient: 'v1',
          },
        }),
      );

      const response = await app
        .request()
        .get(urlString())
        .set('Accept', 'text/html');

      expect(response.status).to.equal(200);
      expect(response.type).to.equal('text/html');
      // should contain graphql-ws browser client
      expect(response.text).to.include('graphql-transport-ws');

      // should contain the subscriptionEndpoint url
      expect(response.text).to.include('ws:\\/\\/localhost');
    });
  });

  describe('Custom validate function', () => {
    it('returns data', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          customValidateFn(schema, documentAST, validationRules) {
            return validate(schema, documentAST, validationRules);
          },
        }),
      );

      const response = await app
        .request()
        .get(urlString({ query: '{ test }', raw: '' }))
        .set('Accept', 'text/html');

      expect(response.status).to.equal(200);
      expect(response.text).to.equal('{"data":{"test":"Hello World"}}');
    });

    it('returns validation errors', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          customValidateFn(schema, documentAST, validationRules) {
            const errors = validate(schema, documentAST, validationRules);

            return [new GraphQLError(`custom error ${errors.length}`)];
          },
        }),
      );

      const response = await app.request().get(
        urlString({
          query: '{ thrower }',
        }),
      );

      expect(response.status).to.equal(400);
      expect(JSON.parse(response.text)).to.deep.equal({
        errors: [
          {
            message: 'custom error 0',
          },
        ],
      });
    });
  });

  describe('Custom validation rules', () => {
    const AlwaysInvalidRule = function (
      context: ValidationContext,
    ): ASTVisitor {
      return {
        Document() {
          context.reportError(
            new GraphQLError('AlwaysInvalidRule was really invalid!'),
          );
        },
      };
    };

    it('does not execute a query if the custom validation does not pass', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          validationRules: [AlwaysInvalidRule],
          pretty: true,
        }),
      );

      const response = await app.request().get(
        urlString({
          query: '{ thrower }',
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

  describe('Custom execute function', () => {
    it('allows to replace the default execute function', async () => {
      const app = server();

      let seenExecuteArgs;

      app.get(
        urlString(),
        graphqlHTTP(() => ({
          schema: TestSchema,
          async customExecuteFn(args) {
            seenExecuteArgs = args;
            const result = await Promise.resolve(execute(args));
            return {
              ...result,
              data: {
                ...result.data,
                test2: 'Modification',
              },
            };
          },
        })),
      );

      const response = await app
        .request()
        .get(urlString({ query: '{ test }' }));

      expect(response.text).to.equal(
        '{"data":{"test":"Hello World","test2":"Modification"}}',
      );
      expect(seenExecuteArgs).to.not.equal(undefined);
    });

    it('catches errors thrown from custom execute function', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP(() => ({
          schema: TestSchema,
          customExecuteFn() {
            throw new Error('I did something wrong');
          },
        })),
      );

      const response = await app
        .request()
        .get(urlString({ query: '{ test }' }));

      expect(response.status).to.equal(400);
      expect(response.text).to.equal(
        '{"errors":[{"message":"I did something wrong"}]}',
      );
    });
  });

  describe('Custom parse function', () => {
    it('can replace default parse functionality', async () => {
      const app = server();

      let seenParseArgs;

      app.get(
        urlString(),
        graphqlHTTP(() => ({
          schema: TestSchema,
          customParseFn(args) {
            seenParseArgs = args;
            return parse(new Source('{ test }', 'Custom parse function'));
          },
        })),
      );

      const response = await app.request().get(urlString({ query: '----' }));

      expect(response.status).to.equal(200);
      expect(response.text).to.equal('{"data":{"test":"Hello World"}}');
      expect(seenParseArgs).property('body', '----');
    });
    it('can throw errors', async () => {
      const app = server();
      app.get(
        urlString(),
        graphqlHTTP(() => ({
          schema: TestSchema,
          customParseFn() {
            throw new GraphQLError('my custom parse error');
          },
        })),
      );

      const response = await app.request().get(urlString({ query: '----' }));

      expect(response.status).to.equal(400);
      expect(response.text).to.equal(
        '{"errors":[{"message":"my custom parse error"}]}',
      );
    });
  });

  describe('Custom result extensions', () => {
    it('allows adding extensions', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP(() => ({
          schema: TestSchema,
          context: { foo: 'bar' },
          extensions({ context }) {
            return { contextValue: JSON.stringify(context) };
          },
        })),
      );

      const response = await app
        .request()
        .get(urlString({ query: '{ test }', raw: '' }))
        .set('Accept', 'text/html');

      expect(response.status).to.equal(200);
      expect(response.type).to.equal('application/json');
      expect(response.text).to.equal(
        '{"data":{"test":"Hello World"},"extensions":{"contextValue":"{\\"foo\\":\\"bar\\"}"}}',
      );
    });

    it('gives extensions access to the initial GraphQL result', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          customFormatErrorFn: () => ({
            message: 'Some generic error message.',
          }),
          extensions({ result }) {
            return { preservedResult: { ...result } };
          },
        }),
      );

      const response = await app.request().get(
        urlString({
          query: '{ thrower }',
        }),
      );

      expect(response.status).to.equal(200);
      expect(JSON.parse(response.text)).to.deep.equal({
        data: { thrower: null },
        errors: [{ message: 'Some generic error message.' }],
        extensions: {
          preservedResult: {
            data: { thrower: null },
            errors: [
              {
                message: 'Throws!',
                locations: [{ line: 1, column: 3 }],
                path: ['thrower'],
              },
            ],
          },
        },
      });
    });

    it('allows the extensions function to be async', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP({
          schema: TestSchema,
          extensions() {
            // Note: you can return arbitrary Promises here!
            return Promise.resolve({ eventually: 42 });
          },
        }),
      );

      const response = await app
        .request()
        .get(urlString({ query: '{ test }', raw: '' }))
        .set('Accept', 'text/html');

      expect(response.status).to.equal(200);
      expect(response.type).to.equal('application/json');
      expect(response.text).to.equal(
        '{"data":{"test":"Hello World"},"extensions":{"eventually":42}}',
      );
    });

    it('does nothing if extensions function does not return an object', async () => {
      const app = server();

      app.get(
        urlString(),
        graphqlHTTP(() => ({
          schema: TestSchema,
          context: { foo: 'bar' },
          extensions: () => undefined,
        })),
      );

      const response = await app
        .request()
        .get(urlString({ query: '{ test }', raw: '' }))
        .set('Accept', 'text/html');

      expect(response.status).to.equal(200);
      expect(response.type).to.equal('application/json');
      expect(response.text).to.equal('{"data":{"test":"Hello World"}}');
    });
  });
}
