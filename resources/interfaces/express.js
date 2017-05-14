/* @flow */
/* Flow declarations for express requests and responses */
/* eslint-disable no-unused-vars */
declare class Request {
  method: String;
  body: Object;
  query: Object;
}

declare class Response {
  status: (code: Number) => Response;
  set: (field: String, value: String) => Response;
  send: (body: String) => void;
  json: (body: Object) => void;
}
