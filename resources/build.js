// @noflow

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ts = require('typescript');
const { main: downlevel } = require('downlevel-dts');

const tsConfig = require('../tsconfig.json');

const {
  transformLoadFileStaticallyFromNPM,
} = require('./load-statically-from-npm');
const { rmdirRecursive, readdirRecursive, showStats } = require('./utils');

if (require.main === module) {
  rmdirRecursive('./dist');
  fs.mkdirSync('./dist');

  const srcFiles = readdirRecursive('./src', { ignoreDir: /^__.*__$/ });
  const { options } = ts.convertCompilerOptionsFromJson(
    tsConfig.compilerOptions,
    process.cwd(),
  );
  const program = ts.createProgram({
    rootNames: srcFiles.map((filepath) => path.join('./src', filepath)),
    options,
  });
  program.emit(undefined, undefined, undefined, undefined, {
    after: [transformLoadFileStaticallyFromNPM],
  });
  downlevel('./dist', './dist/ts3.4');

  fs.copyFileSync('./LICENSE', './dist/LICENSE');
  fs.copyFileSync('./README.md', './dist/README.md');

  // Should be done as the last step so only valid packages can be published
  const packageJSON = buildPackageJSON();
  fs.writeFileSync('./dist/package.json', JSON.stringify(packageJSON, null, 2));

  showStats();
}

function buildPackageJSON() {
  const packageJSON = require('../package.json');
  delete packageJSON.private;
  delete packageJSON.scripts;
  delete packageJSON.devDependencies;

  const { version } = packageJSON;
  const versionMatch = /^\d+\.\d+\.\d+-?(.*)?$/.exec(version);
  if (!versionMatch) {
    throw new Error('Version does not match semver spec: ' + version);
  }

  const [, preReleaseTag] = versionMatch;

  if (preReleaseTag != null) {
    const [tag] = preReleaseTag.split('.');
    assert(['alpha', 'beta', 'rc'].includes(tag), `"${tag}" tag is supported.`);

    assert(!packageJSON.publishConfig, 'Can not override "publishConfig".');
    packageJSON.publishConfig = { tag: tag || 'latest' };
  }

  return packageJSON;
}
