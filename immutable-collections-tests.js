// Import Tinytest from the tinytest Meteor package.
import { Tinytest } from 'meteor/tinytest';
import _ from 'lodash';

// Import and rename a variable exported by immutable-collections.js.
import { name as packageName } from 'meteor/immutable-collections';

// Write your tests here!
// Here is an example.
Tinytest.add('immutable-collections - example', function (test) {
  test.equal(packageName, 'immutable-collections');
});

Tinytest.add('immutable-collections - example2', function (test) {
  test.isTrue(_.isEqual({a: 'b'}, {a: 'b'}));
});
