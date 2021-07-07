require('dotenv').config()

const test = require('ava')
const request = require('supertest')
const _ = require('lodash')

const { before, beforeEach, after } = require('../../lifecycle')
const { getAccessTokenHeaders } = require('../../auth')
const {
  getObjectEvent,
  testEventMetadata,

  checkCursorPaginationScenario,
  checkCursorPaginatedListObject,

  checkOffsetPaginationScenario,
  checkOffsetPaginatedListObject,

  checkFilters,
} = require('../../util')

test.before(async (t) => {
  await before({ name: 'customAttribute' })(t)
  await beforeEach()(t) // concurrent tests are much faster (~3 times here)
})
// test.beforeEach(beforeEach())
test.after(after())

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('list custom attributes with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['customAttribute:list:all'] })

  await checkCursorPaginationScenario({
    t,
    endpointUrl: '/custom-attributes',
    authorizationHeaders,
  })
})

// use serial because no changes must be made during the check
test.serial('check list filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['customAttribute:list:all'] })

  await checkFilters({
    t,
    endpointUrl: '/custom-attributes',
    authorizationHeaders,
    checkPaginationObject: checkCursorPaginatedListObject,

    filters: [
      {
        prop: 'id',
        isArrayFilter: true,
      },
    ],
  })
})

test('finds a custom attribute', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['customAttribute:read:all'] })

  const result = await request(t.context.serverUrl)
    .get('/custom-attributes/attr_WmwQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  const customAttribute = result.body

  t.is(customAttribute.id, 'attr_WmwQps1I3a1gJYz2I3a')
  t.is(customAttribute.name, 'seatingCapacity')
})

test('creates a custom attribute', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['customAttribute:create:all'] })

  const result = await request(t.context.serverUrl)
    .post('/custom-attributes')
    .set(authorizationHeaders)
    .send({
      name: 'longDescription',
      type: 'text',
      metadata: { dummy: true }
    })
    .expect(200)

  const customAttribute = result.body

  t.is(customAttribute.name, 'longDescription')
  t.deepEqual(customAttribute.metadata, { dummy: true })
  t.is(Object.keys(customAttribute.platformData).length, 0)
})

test('list of string values are expected when creating a custom attribute of type "select" or "tags"', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['customAttribute:create:all'] })

  const customAttributeParams = {
    name: 'customOptions',
    type: 'select',
    listValues: ['1', '2', '3']
  }

  await request(t.context.serverUrl)
    .post('/custom-attributes')
    .set(authorizationHeaders)
    .send(Object.assign({}, customAttributeParams, { listValues: [1, 2, 3] }))
    .expect(400)

  await request(t.context.serverUrl)
    .post('/custom-attributes')
    .set(authorizationHeaders)
    .send(Object.assign({}, customAttributeParams, { listValues: [true, false] }))
    .expect(400)

  await request(t.context.serverUrl)
    .post('/custom-attributes')
    .set(authorizationHeaders)
    .send(_.omit(customAttributeParams, 'listValues'))
    .expect(400)

  const result = await request(t.context.serverUrl)
    .post('/custom-attributes')
    .set(authorizationHeaders)
    .send(customAttributeParams)
    .expect(200)

  const customAttribute = result.body

  t.deepEqual(customAttribute.name, customAttributeParams.name)
  t.deepEqual(customAttribute.type, customAttributeParams.type)
  t.deepEqual(customAttribute.listValues, customAttributeParams.listValues)
})

test('creating a custom attribute with different type from previous one is correctly handled', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'customAttribute:create:all',
      'customAttribute:remove:all',
      'search:list:all',
      'asset:create:all',
      'asset:edit:all'
    ]
  })

  // create a custom attribute with type number
  const { body: customAttribute } = await request(t.context.serverUrl)
    .post('/custom-attributes')
    .set(authorizationHeaders)
    .send({
      name: 'changingType',
      type: 'number'
    })
    .expect(200)

  t.is(customAttribute.name, 'changingType')
  t.is(customAttribute.type, 'number')

  const { body: asset } = await request(t.context.serverUrl)
    .post('/assets')
    .set(authorizationHeaders)
    .send({
      name: 'Custom asset',
      ownerId: 'external-user-id',
      assetTypeId: 'typ_RFpfQps1I3a1gJYz2I3a',
      customAttributes: {
        changingType: 10
      }
    })

  await new Promise(resolve => setTimeout(resolve, 2000))

  // filter with this custom attribute in the search
  const { body: searchResult } = await request(t.context.serverUrl)
    .post('/search')
    .set(authorizationHeaders)
    .send({
      customAttributes: {
        changingType: 10
      }
    })

  t.true(searchResult.results.length > 0)
  t.truthy(searchResult.results.find(a => asset.id === a.id))

  // custom attribute is automatically dereferenced from the asset before being removed
  await request(t.context.serverUrl)
    .delete(`/custom-attributes/${customAttribute.id}`)
    .set(authorizationHeaders)
    .expect(200)

  // create a custom attribute with same name and with type boolean
  const { body: newCustomAttribute } = await request(t.context.serverUrl)
    .post('/custom-attributes')
    .set(authorizationHeaders)
    .send({
      name: 'changingType',
      type: 'boolean'
    })
    .expect(200)

  t.is(newCustomAttribute.name, 'changingType')
  t.is(newCustomAttribute.type, 'boolean')

  // performing a search with the custom attribute will trigger an error during reindexation
  await request(t.context.serverUrl)
    .post('/search')
    .set(authorizationHeaders)
    .send({
      customAttributes: {
        changingType: true
      }
    })
    .expect(422)

  await request(t.context.serverUrl)
    .patch(`/assets/${asset.id}`)
    .set(authorizationHeaders)
    .send({
      customAttributes: {
        changingType: true
      }
    })
    .expect(200)

  // let the time for the cron to reindex Elasticsearch index before searching with the new index
  await new Promise(resolve => setTimeout(resolve, 11000))

  // filter with this changed custom attribute in the search
  const { body: searchResult2 } = await request(t.context.serverUrl)
    .post('/search')
    .set(authorizationHeaders)
    .send({
      customAttributes: {
        changingType: true
      }
    })
    .expect(200)

  t.true(searchResult2.results.length > 0)
  t.truthy(searchResult2.results.find(a => asset.id === a.id))
})

test('updates a custom attribute with platformData', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'customAttribute:edit:all',
      'platformData:edit:all'
    ]
  })

  const { body: customAttribute } = await request(t.context.serverUrl)
    .patch('/custom-attributes/attr_WmwQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      metadata: { dummy: true },
      platformData: { hasPlatformData: true }
    })
    .expect(200)

  t.is(customAttribute.id, 'attr_WmwQps1I3a1gJYz2I3a')
  t.true(customAttribute.metadata.dummy)
  t.deepEqual(customAttribute.metadata, {
    dummy: true,
    existingData: [true]
  })
  t.deepEqual(customAttribute.platformData, { hasPlatformData: true })
})

test('cannot update to a shorter list of values if assets still use some of the values', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['customAttribute:edit:all'] })

  await request(t.context.serverUrl)
    .patch('/custom-attributes/attr_RjVQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      listValues: ['bluetooth'], // a non-empty list means we expect all tags to be listed
      metadata: { dummy: true }
    })
    .expect(422)

  t.pass()
})

test('can update to an empty list of tags values if assets still use some of the previous values', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['customAttribute:edit:all'] })

  await request(t.context.serverUrl)
    .patch('/custom-attributes/attr_RjVQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      listValues: [], // free tags
      metadata: { dummy: true }
    })
    .expect(200)

  t.pass()
})

test('list of string values are expected when updating a custom attribute of type "select" or "tags"', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['customAttribute:edit:all'] })

  await request(t.context.serverUrl)
    .patch('/custom-attributes/attr_RjVQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      listValues: [1, 2, 3]
    })
    .expect(400)

  await request(t.context.serverUrl)
    .patch('/custom-attributes/attr_RjVQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      listValues: [true, false]
    })
    .expect(400)

  const customAttributeParams = {
    listValues: ['convertible', 'tinted-glass', 'gps', 'bluetooth', 'sunroof', 'additionalOptions']
  }

  const result = await request(t.context.serverUrl)
    .patch('/custom-attributes/attr_RjVQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send(customAttributeParams)
    .expect(200)

  const customAttribute = result.body

  t.deepEqual(customAttribute.listValues, customAttributeParams.listValues)
})

// This must run serially since there is another test relying on ElasticSearch state.
test.serial('removes a custom attribute after automatic dereferencing and emits asset events', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'customAttribute:read:all',
      'customAttribute:remove:all',
      'asset:create:all',
      'asset:read:all',
      'event:list:all'
    ]
  })

  const attrId = 'attr_WE9Qps1I3a1gJYz2I3a'
  const assetIds = []
  const { body: customAttribute } = await request(t.context.serverUrl)
    .get(`/custom-attributes/${attrId}`)
    .set(authorizationHeaders)
    .expect(200)

  // Create dedicated assets
  for (let i = 0; i < 10; i++) {
    const { body: referencingAsset } = await request(t.context.serverUrl)
      .post('/assets')
      .set(authorizationHeaders)
      .send({
        name: `Asset referencing ${customAttribute.name} - ${i}`,
        ownerId: 'external-user-id',
        assetTypeId: 'typ_RFpfQps1I3a1gJYz2I3a',
        customAttributes: { [customAttribute.name]: 'some text' }
      })
      .expect(200)

    assetIds[i] = referencingAsset.id
  }

  const { body: removed } = await request(t.context.serverUrl)
    .delete(`/custom-attributes/${attrId}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(removed.id, attrId)

  await request(t.context.serverUrl)
    .get(`/custom-attributes/${attrId}`)
    .set(authorizationHeaders)
    .expect(404)

  // Check dereferencing
  await Promise.all(assetIds.map(async assetId => {
    const { body: prunedAsset } = await request(t.context.serverUrl)
      .get(`/assets/${assetId}`)
      .set(authorizationHeaders)
      .expect(200)

    t.is(typeof prunedAsset.customAttributes[customAttribute.name], 'undefined')
  }))

  // Let events be emitted asynchronously
  // For they’re not awaited in customAttribute service before response for performance reasons.
  // Any delay in setTimeout below is not ensuring we always get all events
  // whereas we can find them all in DB after tests.
  // Also tried combining with setImmediate and process.nextTick and ava test.after() in vain…
  // TODO: find a proper workaround
  // Meanwhile, we just check _some_ events are generated
  await new Promise(resolve => setTimeout(resolve, 300))

  // Check events
  const { body: { results: events } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders)
    .expect(200)

  const updateAttrs = { customAttributes: { [customAttribute.name]: null } }
  let type = 'asset__custom_attribute_changed'
  let filteredEvents = events.filter(e => e.type === type && assetIds.includes(e.objectId))
  // We’d rather like to test t.true(filteredEvents.length, assetIds.length)
  // Please refer to comment above about asynchronous events
  t.true(filteredEvents.length > 1 && filteredEvents.length <= assetIds.length)
  t.true(filteredEvents.every(e => _.isEqual(e.changesRequested, updateAttrs)))
  t.true(filteredEvents.every(e => e.metadata.stelaceComment.includes('automatically')))

  type = 'asset__updated'
  filteredEvents = events.filter(e => e.type === type && assetIds.includes(e.objectId))
  // Please refer to comment above
  t.true(filteredEvents.length > 1 && filteredEvents.length <= assetIds.length)
  t.true(filteredEvents.every(e => _.isEqual(e.changesRequested, updateAttrs)))
  t.true(filteredEvents.every(e => e.metadata.stelaceComment.includes('automatically')))
})

// ////// //
// EVENTS //
// ////// //

// Event tests must run serially before the other tests
test.serial('generates custom_attribute__* events', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'customAttribute:create:all',
      'customAttribute:edit:all',
      'customAttribute:remove:all',
      'platformData:edit:all',
      'event:list:all'
    ],
    readNamespaces: ['custom'],
    editNamespaces: ['custom']
  })

  const { body: customAttribute } = await request(t.context.serverUrl)
    .post('/custom-attributes')
    .set(authorizationHeaders)
    .send({
      name: 'customText',
      type: 'text',
      metadata: {
        dummy: [true, false],
        _custom: { test: true }
      }
    })
    .expect(200)

  const patchPayload = {
    metadata: { dummy: [false, true] },
    platformData: { hasPlatformData: true }
  }

  const { body: customAttributeUpdated } = await request(t.context.serverUrl)
    .patch(`/custom-attributes/${customAttribute.id}`)
    .set(authorizationHeaders)
    .send(patchPayload)
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 300))

  const { body: { results: events } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders)
    .expect(200)

  const customAttributeCreatedEvent = getObjectEvent({
    events,
    eventType: 'custom_attribute__created',
    objectId: customAttribute.id
  })
  await testEventMetadata({ event: customAttributeCreatedEvent, object: customAttribute, t })
  t.is(customAttributeCreatedEvent.object.name, customAttribute.name)
  t.is(customAttributeCreatedEvent.object.type, customAttribute.type)
  t.is(Object.keys(customAttributeCreatedEvent.object.platformData).length, 0)

  const customAttributeUpdatedEvent = getObjectEvent({
    events,
    eventType: 'custom_attribute__updated',
    objectId: customAttributeUpdated.id
  })
  await testEventMetadata({
    event: customAttributeUpdatedEvent,
    object: customAttributeUpdated,
    t,
    patchPayload
  })
  t.is(customAttributeUpdatedEvent.object.name, customAttributeUpdated.name)
  t.is(customAttributeUpdatedEvent.object.type, customAttributeUpdated.type)

  await request(t.context.serverUrl)
    .delete(`/custom-attributes/${customAttributeUpdated.id}`)
    .set(authorizationHeaders)
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 300))

  const { body: { results: eventsAfterDelete } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders)
    .expect(200)

  const customAttributeDeletedEvent = getObjectEvent({
    events: eventsAfterDelete,
    eventType: 'custom_attribute__deleted',
    objectId: customAttributeUpdated.id
  })
  await testEventMetadata({ event: customAttributeDeletedEvent, object: customAttributeUpdated, t })
})

// ////////// //
// VALIDATION //
// ////////// //

test('fails to create a custom attribute if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .post('/custom-attributes')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // missing required parameters
  result = await request(t.context.serverUrl)
    .post('/custom-attributes')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({})
    .expect(400)

  error = result.body
  t.true(error.message.includes('"name" is required'))
  t.true(error.message.includes('"type" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .post('/custom-attributes')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: true,
      type: true,
      listValues: true,
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"name" must be a string'))
  t.true(error.message.includes('"type" must be a string'))
  t.true(error.message.includes('"listValues" must be an array'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

test('fails to update a custom attribute if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .patch('/custom-attributes/attr_WmwQps1I3a1gJYz2I3a')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .patch('/custom-attributes/attr_WmwQps1I3a1gJYz2I3a')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      listValues: true,
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"listValues" must be an array'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

// //////// //
// VERSIONS //
// //////// //

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('2019-05-20: list custom attributes with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['customAttribute:list:all']
  })

  await checkOffsetPaginationScenario({
    t,
    endpointUrl: '/custom-attributes',
    authorizationHeaders,
  })
})

test('2019-05-20: list custom attributes with id filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['customAttribute:list:all']
  })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/custom-attributes?id=attr_WmwQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  checkOffsetPaginatedListObject(t, obj)
  t.is(obj.nbResults, 1)
})
