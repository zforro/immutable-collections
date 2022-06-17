import _ from 'lodash';
import { validate,
         assert,
         type,
         object,
         string } from 'superstruct';

import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { Random } from 'meteor/random';


//------------------------------------------------------------------------------

export class ImmutableCollection extends Mongo.Collection {
  constructor(params) {
    const [err, __] = validate(params, type({
      name: string(),
      entityId: string(),
      schema: object(),
      index: object(),
    }));
    if (err) {
      throw new Error(
        errorMessage('immutableCollectionFailedToInit', {params, err})
      );
    };

    const {name, entityId, schema, index} = params;
    super(name, params);
    this.entityId = entityId;
    this.schema = schema;
    this.index = index;

    this.params = params;

    if (Meteor.isServer) this._ensureIndex(index);
  }


  find(selector, options) {
    if (options?.dangerouslyUseRawFind) {
      return super.find(selector, options);
    }

    const {asOf, history} = options ?? {};
    return super.find(_.merge(selector, txSelector(asOf, history)), options);
  }


  findOne(selector, options) {
    if (options?.dangerouslyUseRawFindOne) {
      return super.findOne(selector, options);
    }
    const {asOf, history} = options ?? {};
    const docWithoutHistory =  super.findOne(
      _.merge(selector, txSelector(asOf)), options
    );
    return !history ? docWithoutHistory : this.find(
      {[this.entityId]: docWithoutHistory[this.entityId]},
      options
    ).fetch();
  }


  insert(doc, options, callback) {
    const [_options, _callback] = processArgs(options, callback);
    if (_options?.dangerouslyUseRawInsert) {
      return super.insert(doc, callback);
    }

    if (!doc[this.entityId]) {
      const entityId = (this.params.idGeneration == 'MONGO')
            ? new Mongo.ObjectID()
            : Random.id();
      doc[this.entityId] = entityId;
    }

    const currentDoc = this.findOne(
      {[this.entityId]: doc[this.entityId]}, {reactive: false}
    );
    if (currentDoc) {
      throw new Error(
        errorMessage('insert:DocWithSameEntityIdAlreadyExists', {
          doc,
          entityId: this.entityId
        })
      );
    }

    const newDoc = {
      ...doc, ...{
        tx: {
          latestFrom: new Date(),
          userId: Meteor.userId()
        }
      }
    };
    const [err, __] = validate(newDoc, this.schema);
    if (err) {
      throw new Error(
        errorMessage('insert:DocHasWrongShape', {newDoc, err})
      );
    };

    return super.insert(newDoc, _callback);
  }


  update(selector, modifier, options, callback) {
    const [_options, _callback] = processArgs(options, callback);
    if (_options?.dangerouslyUseRawUpdate) {
      return super.update(selector, modifier, options, callback);
    }

    if (options?.upsert) {
      throw new Error('ImmutableCollection: upsert not implemented');     
    }

    const docs = this.find(selector, {reactive: false}).fetch();
    const temp = new Mongo.Collection(null, this.params);

    for (const doc of docs) {
      temp.insert(doc);
    }
    try {
      const res = temp.update(selector, modifier, options);
      docs.forEach((doc) => {
        const txDate = new Date();
        const updatedDoc = temp.findOne(doc._id, {reactive: false});
        if (!_.isEqual(doc, updatedDoc)) {
          const newDoc = _(updatedDoc)
                .set('tx.latestFrom', txDate)
                .set('tx.userId', Meteor.userId())
                .omit('_id')
                .value();
          const [err, __] = validate(newDoc, this.schema);
          if (err) {
            throw new Error(
              errorMessage(
                'update:DocHasWrongShape', {newDoc, selector, modifier, err}
              )
            );
          };
         
          const res = super.insert(newDoc);
          if (res) {
            super.update(
              {_id: doc._id},
              {
                $set: {
                  'tx.latestUntil': txDate,
                  userId: Meteor.userId()
                }
              });
          }
        }
      });
      if (_callback) {
        return _callback(undefined, res);
      } else {
        return res;
      }
    }
    catch (error) {
      if (_callback) {
        return _callback(error);
      }
      else
      {
        throw new Error(error);
      }
    }
  }


  upsert(selector, modifier, options, callback) {
    if (options?.dangerouslyUseRawUpsert) {
      return super.upsert(selector, modifier, options, callback);
    }

    throw new Error('ImmutableCollection: upsert not implemented');
  }


  remove(selector, options, callback) {
    if (options?.dangerouslyUseRawRemove) {
      return super.remove(selector, options, callback);
    }

    return super.update(selector, {
      $set: {
        'tx.latestUntil': new Date(),
        userId: Meteor.userId()
      }
    });
  }
}


const txSelector = (asOf, history) => {
  if (_.isDate(asOf)) {
    if (history) {
      return {
        'tx.latestFrom': {$lte: asOf}
      };
    }
    else {
      return {
        'tx.latestFrom': {$lte: asOf},
        $or: [
          {'tx.latestUntil': {$gt: asOf}},
          {'tx.latestUntil': {$exists: false}}
        ]
      };
    }
  }
  else if (_.isUndefined(asOf)){
    if (history) {
      return {};
    }
    else {
      return {'tx.latestUntil': {$exists: false}};
    }
  }
  else {
    throw new Error('unexpected value for asOf: `#{asOf}`');
  }
};


const processArgs = (options, callback) => {
  const _options = _.isPlainObject(options) ? options : {};
  const _callback = _.isFunction(options) ? options
        : _.isFunction(callback) ? callback
        : undefined;
  
  return [_options, _callback];
};


const errorMessage = (name, options) => {
  let msg;

  if (name == 'immutableCollectionFailedToInit') {
    const {params, err} = options;
    msg = `new ImmutableCollection(params). <--params have the wrong shape.` +
      `\n${err}`;
  }
  else if (name == 'insert:DocumentWithSameEntityIdAlreadyExists') {
    const {entityId, doc} = options;
    msg = `Insert failed: doc with ${entityId} ${doc.entityId} already exists.`;
  }
  else if (name == 'insert:DocHasWrongShape') {
    const {newDoc, err} = options;
    msg = `Insert failed: doc has wrong shape.\n` +
      `${JSON.stringify(newDoc, null, 4)}\n` +
      `${err}`;
  }
  else if (name == 'update:DocHasWrongShape') {
    const {newDoc, selector, modifier,  err} = options;
    msg = `Update failed: at least one doc would have had the wrong shape.\n` +
      `Doc after attempted update: ${JSON.stringify(newDoc, null, 4)}\n` +
      `selector: ${JSON.stringify(selector, null, 4)}\n` +
      `modifier: ${JSON.stringify(modifier, null, 4)}\n` +
      `${err}`;
  }

  return msg;
};


// Variables exported by this module can be imported by other packages and
// applications. See immutable-collections-tests.js for an example of importing.
export const name = 'immutable-collections';
