Package.describe({
  name: 'zforro:immutable-collections',
  version: '0.0.3',
  summary: 'Immutable Collections for Meteor',
  git: 'https://github.com/zforro/immutable-collections.git',
  documentation: 'README.md'
});

Npm.depends({
  lodash: '4.17.15',
  superstruct: '0.16.0'
});

Package.onUse(function(api) {
  api.versionsFrom('2.7');
  api.use('ecmascript');
  api.mainModule('immutable-collections.js');
});

Package.onTest(function(api) {
  api.use('ecmascript');
  api.use('tinytest');
  api.use('zforro:immutable-collections');
  api.mainModule('immutable-collections-tests.js');
});

