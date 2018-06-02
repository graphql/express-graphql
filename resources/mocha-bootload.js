/**
 * Copyright (c) 2015-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/* eslint-disable no-console */

require('babel-register')({
  plugins: ['transform-async-to-generator', 'transform-runtime'],
});
