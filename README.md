_If you still need to use `express-graphql`, please [read the previous version of this readme](https://github.com/graphql/express-graphql/blob/8b6ffc65776aa40d9e03f554425a1dc14840b165/README.md)._

# This library is deprecated

`express-graphql` was the first official reference implementation of using GraphQL with HTTP. It has existed since 2015 and was mostly unmaintained in recent years.

The official [GraphQL over HTTP](https://github.com/graphql/graphql-over-http) work group is standardizing the way you transport GraphQL over HTTP and it made great progress bringing up the need for a fresh reference implementation.

Please read the [GraphQL over HTTP spec](https://graphql.github.io/graphql-over-http) for detailed implementation information.

## Say hello to [`graphql-http`](https://github.com/graphql/graphql-http)

[`graphql-http`](https://github.com/graphql/graphql-http) is now the GraphQL official reference implementation of the [GraphQL over HTTP spec](https://graphql.github.io/graphql-over-http).

## For users

As a reference implementation, [`graphql-http`](https://github.com/graphql/graphql-http) implements exclusively the [GraphQL over HTTP spec](https://graphql.github.io/graphql-over-http/).

In case you're seeking for a full-featured experience (with file uploads, @defer/@stream directives, subscriptions, etc.), you're recommended to use some of the great JavaScript GraphQL server options:

- [`graphql-yoga`](https://www.the-guild.dev/graphql/yoga-server) ([compliant (0 warnings)](https://github.com/graphql/graphql-http/tree/master/implementations/graphql-yoga), [migration guide](https://www.the-guild.dev/graphql/yoga-server/v3/migration/migration-from-express-graphql))
- [`postgraphile`](https://www.graphile.org/postgraphile/) ([compliant](https://github.com/graphql/graphql-http/tree/master/implementations/postgraphile))
- [`apollo-server`](https://www.apollographql.com/docs/apollo-server/) ([compliant](https://github.com/graphql/graphql-http/tree/master/implementations/apollo-server))
- [`mercurius`](https://mercurius.dev/) ([compliant](https://github.com/graphql/graphql-http/tree/master/implementations/mercurius))
- _\*To add your JavaScript server here, please first add it to [graphql-http/implementations](https://github.com/graphql/graphql-http/tree/master/implementations/)_

## For library authors

Being the official [GraphQL over HTTP spec](https://graphql.github.io/graphql-over-http/) reference implementation, [`graphql-http`](https://github.com/graphql/graphql-http) follows the specification strictly without any additional features (like file uploads, @stream/@defer directives and subscriptions).

Having said this, [`graphql-http`](https://github.com/graphql/graphql-http) is mostly aimed for library authors and simple server setups, where the requirements are exact to what the aforementioned spec offers.

### Spec compliance audit suite

Suite of tests used to audit an HTTP server for [GraphQL over HTTP spec](https://graphql.github.io/graphql-over-http) compliance is [available in `graphql-http`](https://github.com/graphql/graphql-http/blob/master/src/audits/server.ts) and you can use it to check your own, or other, servers!

Additionally, `graphql-http` will maintain a list of GraphQL servers in the ecosystem and share their compliance results ([see them here](https://github.com/graphql/graphql-http/tree/master/implementations)).
