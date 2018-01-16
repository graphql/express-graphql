(function () {
  var data = JSON.parse(document.currentScript.dataSet.data);

  // Collect the URL parameters
  var parameters = {};
  window.location.search.substr(1).split('&').forEach(function (entry) {
    var eq = entry.indexOf('=');
    if (eq >= 0) {
      parameters[decodeURIComponent(entry.slice(0, eq))] =
        decodeURIComponent(entry.slice(eq + 1));
    }
  });

  // Produce a Location query string from a parameter object.
  function locationQuery(params) {
    return '?' + Object.keys(params).filter(function (key) {
      return Boolean(params[key]);
    }).map(function (key) {
      return encodeURIComponent(key) + '=' +
        encodeURIComponent(params[key]);
    }).join('&');
  }

  // Derive a fetch URL from the current URL, sans the GraphQL parameters.
  var graphqlParamNames = {
    query: true,
    variables: true,
    operationName: true
  };

  var otherParams = {};
  for (var k in parameters) {
    if (parameters.hasOwnProperty(k) && graphqlParamNames[k] !== true) {
      otherParams[k] = parameters[k];
    }
  }
  var fetchURL = locationQuery(otherParams);

  // Defines a GraphQL fetcher using the fetch API.
  function graphQLFetcher(graphQLParams) {
    return fetch(fetchURL, {
      method: 'post',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(graphQLParams),
      credentials: 'include',
    }).then(function (response) {
      return response.text();
    }).then(function (responseBody) {
      try {
        return JSON.parse(responseBody);
      } catch (error) {
        return responseBody;
      }
    });
  }

  // When the query and variables string is edited, update the URL bar so
  // that it can be easily shared.
  function onEditQuery(newQuery) {
    parameters.query = newQuery;
    updateURL();
  }

  function onEditVariables(newVariables) {
    parameters.variables = newVariables;
    updateURL();
  }

  function onEditOperationName(newOperationName) {
    parameters.operationName = newOperationName;
    updateURL();
  }

  function updateURL() {
    history.replaceState(null, null, locationQuery(parameters));
  }

  // Render <GraphiQL /> into the body.
  ReactDOM.render(
    React.createElement(GraphiQL, {
      fetcher: graphQLFetcher,
      onEditQuery: onEditQuery,
      onEditVariables: onEditVariables,
      onEditOperationName: onEditOperationName,
      query: data.queryString,
      response: data.resultString,
      variables: data.variablesString,
      operationName: data.operationName,
    }),
    document.body
  );
}());
