import http from 'http';

const data = `query defer_test {
  deferTest {
    text
    ... on GraphQLDeferTest @defer {
      defferedText
    }
  }
}`

const options = {
  hostname: 'localhost',
  port: 4040,
  path: '/graphql',
  method: 'POST',
  headers: {
    'Content-Type': 'application/graphql',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
  
  res.setEncoding('utf8');

  res.on('data', (chunk) => {
    console.log(`BODY: ${chunk}`);
  });

  res.on('end', () => {
    console.log('No more data in response.');
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

// Write data to request body
req.write(data);
req.end();