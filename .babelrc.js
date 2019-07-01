module.exports = {
  plugins: [
    './resources/load-staticly-from-npm.js',
    '@babel/plugin-transform-flow-strip-types',
    '@babel/plugin-transform-modules-commonjs',
  ],
};
