require('dotenv').config()

const test = require('ava')
const request = require('supertest')

const { before, beforeEach, after, createPlatform } = require('../../lifecycle')
const { getAccessTokenHeaders } = require('../../auth')
const {
  getObjectEvent,
  testEventMetadata,
  checkCursorPaginationScenario,
  checkCursorPaginatedListObject,
  checkFilters,
} = require('../../util')

test.before(async t => {
  await before({ name: 'assetType' })(t)
  await beforeEach()(t)
})
// test.beforeEach(beforeEach()) // Concurrent tests are much faster
test.after(after())

// Must serially because it needs an empty platform environment
test.serial('creating the first asset type is the default one unless isDefault parameter is provided', async (t) => {
  const { context } = await createPlatform({ t, minimumFixtures: true })

  const authorizationHeaders = await getAccessTokenHeaders({
    t: { context },
    permissions: [
      'assetType:create:all',
      'assetType:remove:all',
    ]
  })

  const { body: assetType1 } = await request(t.context.serverUrl)
    .post('/asset-types')
    .set(authorizationHeaders)
    .send({
      name: 'Custom selling',
      timeBased: false,
      infiniteStock: false
    })
    .expect(200)

  t.is(assetType1.name, 'Custom selling')
  t.is(assetType1.timeBased, false)
  t.is(assetType1.infiniteStock, false)
  t.is(assetType1.isDefault, true)
  t.is(assetType1.active, true)

  await request(t.context.serverUrl)
    .delete(`/asset-types/${assetType1.id}`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: assetType2 } = await request(t.context.serverUrl)
    .post('/asset-types')
    .set(authorizationHeaders)
    .send({
      name: 'Custom selling',
      timeBased: false,
      infiniteStock: false,
      isDefault: false // override the default behaviour (`isDefault` to true for the first asset type)
    })
    .expect(200)

  t.is(assetType2.name, 'Custom selling')
  t.is(assetType2.timeBased, false)
  t.is(assetType2.infiniteStock, false)
  t.is(assetType2.isDefault, false)
  t.is(assetType2.active, true)
})

// Must serially because it changes the default asset type
test.serial('creating an asset type with `isDefault` to true will change the `isDefault` for other asset types', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'assetType:read:all',
      'assetType:create:all',
      'assetType:edit:all',
      'assetType:remove:all',
    ]
  })

  const { body: currentDefaultAssetType } = await request(t.context.serverUrl)
    .patch('/asset-types/typ_RFpfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      isDefault: true
    })
    .expect(200)

  t.is(currentDefaultAssetType.isDefault, true)

  const { body: newDefaultAssetType } = await request(t.context.serverUrl)
    .post('/asset-types')
    .set(authorizationHeaders)
    .send({
      name: 'New default asset type',
      timeBased: false,
      infiniteStock: false,
      isDefault: true
    })
    .expect(200)

  t.is(newDefaultAssetType.isDefault, true)

  const { body: noLongerDefaultAssetType } = await request(t.context.serverUrl)
    .get('/asset-types/typ_RFpfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      isDefault: true
    })
    .expect(200)

  t.is(noLongerDefaultAssetType.isDefault, false)
})

// Must serially because it changes the default asset type
test.serial('changes the default asset type', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'assetType:read:all',
      'assetType:edit:all'
    ]
  })

  const assetTypeId2 = 'typ_rL6IBMe1wlK1iJ9NNwlK'

  // manually fetch the current default asset type
  const { body: { results: defaultAssetTypes } } = await request(t.context.serverUrl)
    .get('/asset-types?isDefault=true')
    .set(authorizationHeaders)
    .expect(200)

  const [beforeUpdateAssetType1] = defaultAssetTypes // it can only have one default asset type

  t.is(beforeUpdateAssetType1.isDefault, true)

  const { body: beforeUpdateAssetType2 } = await request(t.context.serverUrl)
    .get(`/asset-types/${assetTypeId2}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(beforeUpdateAssetType2.isDefault, false)

  const { body: afterUpdateAssetType2 } = await request(t.context.serverUrl)
    .patch(`/asset-types/${assetTypeId2}`)
    .set(authorizationHeaders)
    .send({
      isDefault: true
    })
    .expect(200)

  t.is(afterUpdateAssetType2.isDefault, true)

  const { body: afterUpdateAssetType1 } = await request(t.context.serverUrl)
    .get(`/asset-types/${beforeUpdateAssetType1.id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(afterUpdateAssetType1.isDefault, false)
})

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('list asset types', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['assetType:list:all'] })

  await checkCursorPaginationScenario({
    t,
    endpointUrl: '/asset-types',
    authorizationHeaders
  })
})

// use serial because no changes must be made during the check
test.serial('check list filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['assetType:list:all'] })

  await checkFilters({
    t,
    endpointUrl: '/asset-types',
    authorizationHeaders,
    checkPaginationObject: checkCursorPaginatedListObject,

    filters: [
      {
        prop: 'id',
        isArrayFilter: true,
      },
      {
        prop: 'createdDate',
        isRangeFilter: true,
      },
      {
        prop: 'updatedDate',
        isRangeFilter: true,
      },
      {
        prop: 'isDefault',
        customTestValues: [true, false],
      },
      {
        prop: 'active',
        customTestValues: [true, false],
      },
    ],
  })
})

test('finds an asset type', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['assetType:read:all'] })

  const result = await request(t.context.serverUrl)
    .get('/asset-types/typ_RFpfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  const assetType = result.body

  t.is(assetType.id, 'typ_RFpfQps1I3a1gJYz2I3a')
})

test('creates an asset type', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['assetType:create:all'] })

  const result = await request(t.context.serverUrl)
    .post('/asset-types')
    .set(authorizationHeaders)
    .send({
      name: 'Selling',
      timeBased: false,
      infiniteStock: false,
      pricing: {
        ownerFeesPercent: 0,
        takerFeesPercent: 5
      },
      timing: {
        timeUnit: 'd',
        minDuration: { d: 1 },
        maxDuration: { d: 100 }
      },
      namespaces: {
        visibility: {
          protected: ['validated']
        }
      },
      active: true,
      metadata: { dummy: true }
    })
    .expect(200)

  const assetType = result.body

  t.is(assetType.name, 'Selling')
  t.is(typeof assetType.pricing, 'object')
  t.is(typeof assetType.timing, 'object')
  t.is(typeof assetType.namespaces, 'object')
  t.is(assetType.timeBased, false)
  t.is(assetType.pricing.ownerFeesPercent, 0)
  t.is(assetType.active, true)
  t.is(assetType.metadata.dummy, true)
})

test('creates an asset type with platform data', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'assetType:create:all',
      'platformData:edit:all'
    ],
    readNamespaces: ['custom'],
    editNamespaces: ['custom']
  })

  const { body: assetType } = await request(t.context.serverUrl)
    .post('/asset-types')
    .set(authorizationHeaders)
    .send({
      name: 'Asset Type with platform data',
      timeBased: false,
      infiniteStock: false,
      metadata: {
        dummy: true,
        _custom: {
          test: true
        }
      },
      platformData: {
        test: true,
        _custom: {
          ok: true
        }
      }
    })
    .expect(200)

  t.true(assetType.metadata._custom.test)
  t.true(typeof assetType.metadata.test === 'undefined')
  t.true(typeof assetType.platformData.dummy === 'undefined')
  t.true(assetType.platformData.test)
  t.true(assetType.platformData._custom.ok)

  await request(t.context.serverUrl)
    .post('/asset-types')
    .set(authorizationHeaders)
    .send({
      name: 'Asset Type with forbidden namespace in platform data',
      timeBased: false,
      infiniteStock: false,
      metadata: {
        dummy: true,
        _custom: {
          test: true
        }
      },
      platformData: {
        test: true,
        _custom: {
          ok: true
        },
        _extra: {}
      }
    })
    .expect(403)
})

test('creates an asset type with transaction process', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['assetType:create:all'] })

  await request(t.context.serverUrl)
    .post('/asset-types')
    .set(authorizationHeaders)
    .send({
      name: 'Selling',
      timeBased: false,
      infiniteStock: false,
      transactionProcess: {
        initStatus: 'draft',
        cancelStatus: 'cancelled',
        transitions: [
          { name: 'cancel', from: 'draft', to: 'cancelled', actors: ['owner'] }
        ]
      }
    })
    .expect(200)

  t.pass()
})

test('cannot create an asset type with invalid transaction process', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['assetType:create:all'] })

  await request(t.context.serverUrl)
    .post('/asset-types')
    .set(authorizationHeaders)
    .send({
      name: 'Selling',
      timeBased: false,
      infiniteStock: false,
      transactionProcess: {
        initStatus: 'draft',
        cancelStatus: 'cancelled',
        transitions: [] // missing specified statuses
      }
    })
    .expect(422)

  t.pass()
})

test('updates an asset type', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['assetType:edit:all'] })

  const result = await request(t.context.serverUrl)
    .patch('/asset-types/typ_RFpfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      name: 'Custom selling',
      infiniteStock: true,
      namespaces: {
        visibility: {
          protected: ['validated']
        }
      },
      metadata: { dummy: true }
    })
    .expect(200)

  const assetType = result.body

  t.is(assetType.id, 'typ_RFpfQps1I3a1gJYz2I3a')
  t.is(assetType.name, 'Custom selling')
  t.is(typeof assetType.namespaces, 'object')
  t.is(assetType.infiniteStock, true)
  t.is(assetType.metadata.dummy, true)
})

test('updates the asset type time unit', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['assetType:edit:all'] })

  const { body: assetType } = await request(t.context.serverUrl)
    .patch('/asset-types/typ_RFpfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      timing: {
        timeUnit: 'M'
      }
    })
    .expect(200)

  t.is(assetType.id, 'typ_RFpfQps1I3a1gJYz2I3a')
  t.is(assetType.timing.timeUnit, 'M')
})

test('updates an asset type with platform data', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'assetType:edit:all',
      'platformData:edit:all'
    ],
    readNamespaces: ['custom'],
    editNamespaces: ['custom']
  })

  const { body: assetType } = await request(t.context.serverUrl)
    .patch('/asset-types/typ_Z0xfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      name: 'Asset Type Updated with platform data',
      metadata: {
        dummy: false,
        _custom: {
          test: false
        }
      },
      platformData: {
        test: true,
        _custom: {
          ok: true
        }
      }
    })
    .expect(200)

  t.false(assetType.metadata._custom.test)
  t.is(assetType.metadata.metadataOnly, 'notPlatformData') // merged fixture metadata
  t.falsy(assetType.metadata.platformDataOnly) // check for cross-data leaks

  t.true(assetType.platformData.test)
  t.true(assetType.platformData._custom.ok)
  t.falsy(assetType.platformData.metadataOnly) // check for cross-data leaks
  t.is(assetType.platformData.platformDataOnly, 'notMetadata') // & cross-data overwrite

  await request(t.context.serverUrl)
    .patch('/asset-types/typ_Z0xfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      name: 'Asset Type Updated with forbidden namespace in platform data',
      metadata: {
        dummy: true,
        _custom: {
          test: true
        }
      },
      platformData: {
        test: true,
        _custom: {
          ok: true
        },
        _extra: {}
      }
    })
    .expect(403)
})

test('updates an asset type with transaction process', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['assetType:edit:all'] })

  await request(t.context.serverUrl)
    .patch('/asset-types/typ_Z0xfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      transactionProcess: {
        initStatus: 'draft',
        cancelStatus: 'cancelled',
        transitions: [
          { name: 'cancel', from: 'draft', to: 'cancelled', actors: ['owner'] }
        ]
      }
    })
    .expect(200)

  t.pass()
})

test('cannot update an asset type with invalid transaction process', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['assetType:edit:all'] })

  await request(t.context.serverUrl)
    .patch('/asset-types/typ_Z0xfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      transactionProcess: {
        initStatus: 'draft',
        cancelStatus: 'cancelled',
        transitions: [] // missing specified statuses
      }
    })
    .expect(422)

  t.pass()
})

test('removes an asset type', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'assetType:read:all',
      'assetType:create:all',
      'assetType:remove:all'
    ]
  })

  const { body: assetType } = await request(t.context.serverUrl)
    .post('/asset-types')
    .set(authorizationHeaders)
    .send({
      name: 'Asset type to remove',
      timeBased: true,
      infiniteStock: false
    })
    .expect(200)

  const result = await request(t.context.serverUrl)
    .delete(`/asset-types/${assetType.id}`)
    .set(authorizationHeaders)
    .expect(200)

  const payload = result.body

  t.is(payload.id, assetType.id)

  await request(t.context.serverUrl)
    .get(`/asset-types/${assetType.id}`)
    .set(authorizationHeaders)
    .expect(404)
})

test('cannot remove an asset type when assets are still associated to it', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'assetType:read:all',
      'assetType:remove:all'
    ]
  })

  await request(t.context.serverUrl)
    .delete('/asset-types/typ_RFpfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(422)

  t.pass()
})

// ////////// //
// VALIDATION //
// ////////// //

test('fails to create an asset type if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .post('/asset-types')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // missing required parameters
  result = await request(t.context.serverUrl)
    .post('/asset-types')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({})
    .expect(400)

  error = result.body
  t.true(error.message.includes('"name" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .post('/asset-types')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: true,
      timeBased: 'invalid',
      infiniteStock: 'invalid',
      pricing: true,
      timing: true,
      unavailableWhen: true,
      transactionProcess: true,
      namespaces: true,
      isDefault: 'invalid',
      active: 'invalid',
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"name" must be a string'))
  t.true(error.message.includes('"timeBased" must be a boolean'))
  t.true(error.message.includes('"infiniteStock" must be a boolean'))
  t.true(error.message.includes('"pricing" must be of type object'))
  t.true(error.message.includes('"timing" must be of type object'))
  t.true(error.message.includes('"unavailableWhen" must be an array'))
  t.true(error.message.includes('"transactionProcess" must be of type object'))
  t.true(error.message.includes('"namespaces" must be of type object'))
  t.true(error.message.includes('"isDefault" must be a boolean'))
  t.true(error.message.includes('"active" must be a boolean'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

test('fails to update an asset type if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .patch('/asset-types/typ_RFpfQps1I3a1gJYz2I3a')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .patch('/asset-types/typ_RFpfQps1I3a1gJYz2I3a')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: true,
      timeBased: 'invalid',
      infiniteStock: 'invalid',
      pricing: true,
      timing: true,
      unavailableWhen: true,
      transactionProcess: true,
      namespaces: true,
      isDefault: 'invalid',
      active: 'invalid',
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"name" must be a string'))
  t.true(error.message.includes('"timeBased" must be a boolean'))
  t.true(error.message.includes('"infiniteStock" must be a boolean'))
  t.true(error.message.includes('"pricing" must be of type object'))
  t.true(error.message.includes('"timing" must be of type object'))
  t.true(error.message.includes('"unavailableWhen" must be an array'))
  t.true(error.message.includes('"transactionProcess" must be of type object'))
  t.true(error.message.includes('"namespaces" must be of type object'))
  t.true(error.message.includes('"isDefault" must be a boolean'))
  t.true(error.message.includes('"active" must be a boolean'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

// ////// //
// EVENTS //
// ////// //

// Event tests must run serially before the other tests
test.serial('generates asset_type__* events', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'assetType:create:all',
      'assetType:edit:all',
      'assetType:remove:all',
      'event:list:all'
    ],
    readNamespaces: ['custom'],
    editNamespaces: ['custom']
  })

  const { body: assetType } = await request(t.context.serverUrl)
    .post('/asset-types')
    .set(authorizationHeaders)
    .send({
      name: 'Created Event Test Asset Type',
      active: true,
      timeBased: false,
      infiniteStock: false,
      metadata: {
        test1: true,
        _custom: {
          hasDataInNamespace: true
        }
      }
    })
    .expect(200)

  const patchPayload = {
    name: 'Updated Event Test Asset Type, after update',
    timeBased: true,
    metadata: {
      test2: true,
      _custom: {
        hasAdditionalDataInNamespace: true
      }
    }
  }

  const { body: assetTypeUpdated } = await request(t.context.serverUrl)
    .patch(`/asset-types/${assetType.id}`)
    .set(authorizationHeaders)
    .send(patchPayload)
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 300))

  const { body: { results: events } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders)
    .expect(200)

  const assetTypeCreatedEvent = getObjectEvent({
    events,
    eventType: 'asset_type__created',
    objectId: assetType.id
  })
  await testEventMetadata({ event: assetTypeCreatedEvent, object: assetType, t })
  t.is(assetTypeCreatedEvent.object.name, assetType.name)
  t.is(assetTypeCreatedEvent.object.timeBased, assetType.timeBased)
  t.is(assetTypeCreatedEvent.object.metadata._custom.hasDataInNamespace, true)
  t.not(assetTypeCreatedEvent.object.metadata._custom.hasAdditionalDataInNamespace, true)

  const assetTypeUpdatedEvent = getObjectEvent({
    events,
    eventType: 'asset_type__updated',
    objectId: assetTypeUpdated.id
  })
  await testEventMetadata({
    event: assetTypeUpdatedEvent,
    object: assetTypeUpdated,
    t,
    patchPayload
  })
  t.is(assetTypeUpdatedEvent.object.name, assetTypeUpdated.name)
  t.is(assetTypeUpdatedEvent.object.timeBased, assetTypeUpdated.timeBased)
  t.is(assetTypeUpdatedEvent.object.metadata._custom.hasDataInNamespace, true)
  t.is(assetTypeUpdatedEvent.object.metadata._custom.hasAdditionalDataInNamespace, true)

  await request(t.context.serverUrl)
    .delete(`/asset-types/${assetTypeUpdated.id}`)
    .set(authorizationHeaders)
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 300))

  const { body: { results: eventsAfterDelete } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders)
    .expect(200)

  const assetTypeDeletedEvent = getObjectEvent({
    events: eventsAfterDelete,
    eventType: 'asset_type__deleted',
    objectId: assetTypeUpdated.id
  })
  await testEventMetadata({ event: assetTypeDeletedEvent, object: assetTypeUpdated, t })
})

// //////// //
// VERSIONS //
// //////// //

test('2019-05-20: list asset types', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['assetType:list:all']
  })

  const result = await request(t.context.serverUrl)
    .get('/asset-types')
    .set(authorizationHeaders)
    .expect(200)

  const assetTypes = result.body

  t.true(Array.isArray(assetTypes))
})
