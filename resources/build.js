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
const { rmdirRecursive, readdirRecursive, showDirStats } = require('./utils');

if (require.main === module) {
  rmdirRecursive('./npmDist');
  fs.mkdirSync('./npmDist');

  const srcFiles = readdirRecursive('./src', { ignoreDir: /^__.*__$/ });
  const { options } = ts.convertCompilerOptionsFromJson(
    { ...tsConfig.compilerOptions, outDir: 'npmDist' },
    process.cwd(),
  );
  const program = ts.createProgram({
    rootNames: srcFiles.map((filepath) => path.join('./src', filepath)),
    options,
  });
  program.emit(undefined, undefined, undefined, undefined, {
    after: [transformLoadFileStaticallyFromNPM],
  });
  downlevel('./npmDist', './npmDist/ts3.4');

  fs.copyFileSync('./LICENSE', './npmDist/LICENSE');
  fs.copyFileSync('./README.md', './npmDist/README.md');

  // Should be done as the last step so only valid packages can be published
  const packageJSON = buildPackageJSON();
  fs.writeFileSync(
    './npmDist/package.json',
    JSON.stringify(packageJSON, null, 2),
  );

  showDirStats('./npmDist');
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
