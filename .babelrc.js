module.exports = {
  presets: [
    [
      'env',
      {
        modules: process.env.ESM ? false : 'commonjs',
        targets: {
          node: require('./package.json').engines.node.substring(2), // Strip `>=`
        },
      },
    ],
  ],
  plugins: ['transform-class-properties', 'transform-flow-strip-types'],
  ignore: ['__tests__'],
};
