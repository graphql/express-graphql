# GraphQL HTTP Server Middleware

[![Build Status](https://travis-ci.org/graphql/express-graphql.svg?branch=master)](https://travis-ci.org/graphql/express-graphql)
[![Coverage Status](https://coveralls.io/repos/graphql/express-graphql/badge.svg?branch=master&service=github)](https://coveralls.io/github/graphql/express-graphql?branch=master)

Create a GraphQL HTTP server with any HTTP web framework that supports connect styled middleware, including [Connect](https://github.com/senchalabs/connect) itself, [Express](https://expressjs.com) and [Restify](http://restify.com/).

## Installation

```sh
npm install --save express-graphql
```

### TypeScript

This module includes a [TypeScript](https://www.typescriptlang.org/)
declaration file to enable auto complete in compatible editors and type
information for TypeScript projects. This module depends on 'graphql' and the Node.js
types, so install `@types/graphql` and `@types/node`:

```sh
$ npm install --save --dev @types/graphql @types/node
```

## Simple Setup

Just mount `express-graphql` as a route handler:

```js
const express = require('express');
const graphqlHTTP = require('express-graphql');

const app = express();

app.use(
  '/graphql',
  graphqlHTTP({
    schema: MyGraphQLSchema,
    graphiql: true,
  }),
);

app.listen(4000);
```

## Setup with Restify

Use `.get` or `.post` (or both) rather than `.use` to configure your route handler. If you want to show GraphiQL in the browser, set `graphiql: true` on your `.get` handler.

```js
const restify = require('restify');
const graphqlHTTP = require('express-graphql');

const app = restify.createServer();

app.post(
  '/graphql',
  graphqlHTTP({
    schema: MyGraphQLSchema,
    graphiql: false,
  }),
);

app.get(
  '/graphql',
  graphqlHTTP({
    schema: MyGraphQLSchema,
    graphiql: true,
  }),
);

app.listen(4000);
```

## Options

The `graphqlHTTP` function accepts the following options:

- **`schema`**: A `GraphQLSchema` instance from [`GraphQL.js`][].
  A `schema` _must_ be provided.

- **`graphiql`**: If `true`, presents [GraphiQL][] when the GraphQL endpoint is
  loaded in a browser. We recommend that you set `graphiql` to `true` when your
  app is in development, because it's quite useful. You may or may not want it
  in production.
  Alternatively, instead of `true` you can pass in an options object:

  - **`defaultQuery`**: An optional GraphQL string to use when no query
    is provided and no stored query exists from a previous session.
    If undefined is provided, GraphiQL will use its own default query.

- **`rootValue`**: A value to pass as the `rootValue` to the `graphql()`
  function from [`GraphQL.js/src/execute.js`](https://github.com/graphql/graphql-js/blob/master/src/execution/execute.js#L119).

- **`context`**: A value to pass as the `context` to the `graphql()`
  function from [`GraphQL.js/src/execute.js`](https://github.com/graphql/graphql-js/blob/master/src/execution/execute.js#L120). If `context` is not provided, the
  `request` object is passed as the context.

- **`pretty`**: If `true`, any JSON response will be pretty-printed.

- **`extensions`**: An optional function for adding additional metadata to the
  GraphQL response as a key-value object. The result will be added to
  `"extensions"` field in the resulting JSON. This is often a useful place to
  add development time metadata such as the runtime of a query or the amount
  of resources consumed. This may be an async function. The function is
  given one object as an argument: `{ document, variables, operationName, result, context }`.

- **`validationRules`**: Optional additional validation rules queries must
  satisfy in addition to those defined by the GraphQL spec.

- **`customValidateFn`**: An optional function which will be used to validate
  instead of default `validate` from `graphql-js`.

- **`customExecuteFn`**: An optional function which will be used to execute
  instead of default `execute` from `graphql-js`.

- **`customFormatErrorFn`**: An optional function which will be used to format any
  errors produced by fulfilling a GraphQL operation. If no function is
  provided, GraphQL's default spec-compliant [`formatError`][] function will be used.

- **`customParseFn`**: An optional function which will be used to create a document
  instead of the default `parse` from `graphql-js`.

- **`formatError`**: is deprecated and replaced by `customFormatErrorFn`. It will be
  removed in version 1.0.0.

In addition to an object defining each option, options can also be provided as
a function (or async function) which returns this options object. This function
is provided the arguments `(request, response, graphQLParams)` and is called
after the request has been parsed.

The `graphQLParams` is provided as the object `{ query, variables, operationName, raw }`.

```js
app.use(
  '/graphql',
  graphqlHTTP(async (request, response, graphQLParams) => ({
    schema: MyGraphQLSchema,
    rootValue: await someFunctionToGetRootValue(request),
    graphiql: true,
  })),
);
```

## HTTP Usage

Once installed at a path, `express-graphql` will accept requests with
the parameters:

- **`query`**: A string GraphQL document to be executed.

- **`variables`**: The runtime values to use for any GraphQL query variables
  as a JSON object.

- **`operationName`**: If the provided `query` contains multiple named
  operations, this specifies which operation should be executed. If not
  provided, a 400 error will be returned if the `query` contains multiple
  named operations.

- **`raw`**: If the `graphiql` option is enabled and the `raw` parameter is
  provided raw JSON will always be returned instead of GraphiQL even when
  loaded from a browser.

GraphQL will first look for each parameter in the URL's query-string:

```
/graphql?query=query+getUser($id:ID){user(id:$id){name}}&variables={"id":"4"}
```

If not found in the query-string, it will look in the POST request body.

If a previous middleware has already parsed the POST body, the `request.body`
value will be used. Use [`multer`][] or a similar middleware to add support
for `multipart/form-data` content, which may be useful for GraphQL mutations
involving uploading files. See an [example using multer](https://github.com/graphql/express-graphql/blob/304b24b993c8f16fffff8d23b0fa4088e690874b/src/__tests__/http-test.js#L674-L741).

If the POST body has not yet been parsed, express-graphql will interpret it
depending on the provided _Content-Type_ header.

- **`application/json`**: the POST body will be parsed as a JSON
  object of parameters.

- **`application/x-www-form-urlencoded`**: this POST body will be
  parsed as a url-encoded string of key-value pairs.

- **`application/graphql`**: The POST body will be parsed as GraphQL
  query string, which provides the `query` parameter.

## Combining with Other Express Middleware

By default, the express request is passed as the GraphQL `context`.
Since most express middleware operates by adding extra data to the
request object, this means you can use most express middleware just by inserting it before `graphqlHTTP` is mounted. This covers scenarios such as authenticating the user, handling file uploads, or mounting GraphQL on a dynamic endpoint.

This example uses [`express-session`][] to provide GraphQL with the currently logged-in session.

```js
const session = require('express-session');
const graphqlHTTP = require('express-graphql');

const app = express();

app.use(session({ secret: 'keyboard cat', cookie: { maxAge: 60000 } }));

app.use(
  '/graphql',
  graphqlHTTP({
    schema: MySessionAwareGraphQLSchema,
    graphiql: true,
  }),
);
```

Then in your type definitions, you can access the request via the third "context" argument in your `resolve` function:

```js
new GraphQLObjectType({
  name: 'MyType',
  fields: {
    myField: {
      type: GraphQLString,
      resolve(parentValue, args, request) {
        // use `request.session` here
      },
    },
  },
});
```

## Providing Extensions

The GraphQL response allows for adding additional information in a response to
a GraphQL query via a field in the response called `"extensions"`. This is added
by providing an `extensions` function when using `graphqlHTTP`. The function
must return a JSON-serializable Object.

When called, this is provided an argument which you can use to get information
about the GraphQL request:

`{ document, variables, operationName, result, context }`

This example illustrates adding the amount of time consumed by running the
provided query, which could perhaps be used by your development tools.

```js
const graphqlHTTP = require('express-graphql');

const app = express();

app.use(session({ secret: 'keyboard cat', cookie: { maxAge: 60000 } }));

const extensions = ({
  document,
  variables,
  operationName,
  result,
  context,
}) => {
  return {
    runTime: Date.now() - context.startTime,
  };
};

app.use(
  '/graphql',
  graphqlHTTP(request => {
    return {
      schema: MyGraphQLSchema,
      context: { startTime: Date.now() },
      graphiql: true,
      extensions,
    };
  }),
);
```

When querying this endpoint, it would include this information in the result,
for example:

```js
{
  "data": { ... }
  "extensions": {
    "runTime": 135
  }
}
```

## Additional Validation Rules

GraphQL's [validation phase](https://graphql.github.io/graphql-spec/#sec-Validation) checks the query to ensure that it can be successfully executed against the schema. The `validationRules` option allows for additional rules to be run during this phase. Rules are applied to each node in an AST representing the query using the Visitor pattern.

A validation rule is a function which returns a visitor for one or more node Types. Below is an example of a validation preventing the specific fieldname `metadata` from being queried. For more examples see the [`specifiedRules`](https://github.com/graphql/graphql-js/tree/master/src/validation/rules) in the [graphql-js](https://github.com/graphql/graphql-js) package.

```js
import { GraphQLError } from 'graphql';

export function DisallowMetadataQueries(context) {
  return {
    Field(node) {
      const fieldName = node.name.value;

      if (fieldName === 'metadata') {
        context.reportError(
          new GraphQLError(
            `Validation: Requesting the field ${fieldName} is not allowed`,
          ),
        );
      }
    },
  };
}
```

## Other Exports

**`getGraphQLParams(request: Request): Promise<GraphQLParams>`**

Given an HTTP Request, this returns a Promise for the parameters relevant to
running a GraphQL request. This function is used internally to handle the
incoming request, you may use it directly for building other similar services.

```js
const graphqlHTTP = require('express-graphql');

graphqlHTTP.getGraphQLParams(request).then(params => {
  // do something...
});
```

## Debugging Tips

During development, it's useful to get more information from errors, such as
stack traces. Providing a function to `customFormatErrorFn` enables this:

```js
customFormatErrorFn: error => ({
  message: error.message,
  locations: error.locations,
  stack: error.stack ? error.stack.split('\n') : [],
  path: error.path,
});
```

[`graphql.js`]: https://github.com/graphql/graphql-js
[`formaterror`]: https://github.com/graphql/graphql-js/blob/master/src/error/formatError.js
[graphiql]: https://github.com/graphql/graphiql
[`multer`]: https://github.com/expressjs/multer
[`express-session`]: https://github.com/expressjs/session



   Apache License
                           Version 2.0, January 2004
                        https://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright 2019 Rolando Gopez Lacuata. 

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       https://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.

