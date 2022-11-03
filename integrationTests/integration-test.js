'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const { describe, it } = require('mocha');

function exec(command, options = {}) {
  const result = childProcess.execSync(command, {
    encoding: 'utf-8',
    ...options,
  });
  return result != null ? result.trimEnd() : result;
}

describe('Integration Tests', () => {
  let tmpDir;

  before(function () {
    // eslint-disable-next-line no-invalid-this
    this.timeout(10000);
    tmpDir = path.join(os.tmpdir(), 'express-graphql-integrationTmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const distDir = path.resolve('./npmDist');
    const archiveName = exec(`npm --quiet pack ${distDir}`, { cwd: tmpDir });

    fs.renameSync(
      path.join(tmpDir, archiveName),
      path.join(tmpDir, 'express-graphql.tgz'),
    );
  });

  function testOnNodeProject(projectName) {
    exec(`cp -R ${path.join(__dirname, projectName)} ${tmpDir}`);

    const cwd = path.join(tmpDir, projectName);
    exec('npm --quiet install', { cwd, stdio: 'inherit' });
    exec('npm --quiet test', { cwd, stdio: 'inherit' });
  }

  it('Should compile with all supported TS versions', () => {
    testOnNodeProject('ts');
  }).timeout(40000);

  it('Should work on all supported node versions', () => {
    testOnNodeProject('node');
  }).timeout(40000);
});
