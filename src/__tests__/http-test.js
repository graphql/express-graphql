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
      if (!error) {
        throw new Error('Expected to catch error.');
      }
      return error;
    }
  );
}

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
      it('handles errors caught by GraphQL', async () => {
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

      it('handles untyped POST text', async () => {
        var app = express();

        app.use(urlString(), graphqlHTTP({
          schema: TestSchema
        }));

        var error = await catchError(
          // Note: no Content-Type header.
          request(app)
            .post(urlString({
              variables: JSON.stringify({ who: 'Dolly' })
            }))
            .send('query helloWho($who: String){ test(who: $who) }')
        );

        expect(error.response.status).to.equal(400);
        expect(JSON.parse(error.response.text)).to.deep.equal({
          errors: [ { message: 'Must provide query string.' } ]
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
