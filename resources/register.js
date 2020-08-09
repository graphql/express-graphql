'use strict';

const {
  transformLoadFileStaticallyFromNPM,
} = require('./load-statically-from-npm');

require('ts-node').register({
  transformers: () => ({
    after: [transformLoadFileStaticallyFromNPM],
  }),
});
