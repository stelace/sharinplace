require('dotenv').config()

const test = require('ava')
const request = require('supertest')

const { before, beforeEach, after, createPlatform } = require('../../lifecycle')
const { getAccessTokenHeaders } = require('../../auth')
const { getModels } = require('../../../src/models')
const {
  getObjectEvent,
  testEventMetadata,
  testEventDelay,

  checkCursorPaginationScenario,
  checkCursorPaginatedListObject,

  checkOffsetPaginationScenario,
  checkOffsetPaginatedListObject,

  checkFilters,
} = require('../../util')

test.before(async t => {
  await before({ name: 'asset' })(t)
  await beforeEach()(t)
})
// test.beforeEach(beforeEach()) // Concurrent tests are much faster
test.after(after())

// from fixtures
const defaultAssetTypeId = 'typ_RFpfQps1I3a1gJYz2I3a'

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('list assets with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['asset:list:all'] })

  await checkCursorPaginationScenario({
    t,
    endpointUrl: '/assets',
    authorizationHeaders,
  })
})

test('list assets for the current user', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['asset:list'],
    userId: '7308ffc8-a046-4965-bb4a-b1184a42325c'
  })

  await request(t.context.serverUrl)
    .get('/assets')
    .set(authorizationHeaders)
    .expect(403)

  await request(t.context.serverUrl)
    .get('/assets?ownerId=user_QVQzajA5ZnMxgYbWM930qpyvKyRHMxJ,user-external-id')
    .set(authorizationHeaders)
    .expect(403)

  await request(t.context.serverUrl)
    .get('/assets?ownerId=7308ffc8-a046-4965-bb4a-b1184a42325c')
    .set(authorizationHeaders)
    .expect(200)

  const authorizationHeaders2 = await getAccessTokenHeaders({
    t,
    permissions: ['asset:list:all'],
    userId: '7308ffc8-a046-4965-bb4a-b1184a42325c'
  })

  await request(t.context.serverUrl)
    .get('/assets')
    .set(authorizationHeaders2)
    .expect(200)

  t.pass()
})

// use serial because no changes must be made during the check
test.serial('check list filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['asset:list:all'] })

  await checkFilters({
    t,
    endpointUrl: '/assets',
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
        prop: 'ownerId',
        isArrayFilter: true,
      },
      {
        prop: 'categoryId',
        isArrayFilter: true,
      },
      {
        prop: 'assetTypeId',
        isArrayFilter: true,
      },
      {
        prop: 'validated',
        customTestValues: [true, false],
      },
      {
        prop: 'active',
        customTestValues: [true, false],
      },
      {
        prop: 'quantity',
        isRangeFilter: true,
      },
      {
        prop: 'price',
        isRangeFilter: true,
      },
    ],
  })
})

test('finds an asset', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['asset:read:all'] })

  const result = await request(t.context.serverUrl)
    .get('/assets/ast_0TYM7rs1OwP1gQRuCOwP')
    .set(authorizationHeaders)
    .expect(200)

  const asset = result.body

  t.is(asset.id, 'ast_0TYM7rs1OwP1gQRuCOwP')
  t.is(asset.name, 'Chevrolet')
})

test('finds own asset (display private and protected namespace)', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['asset:read:all'], userId: 'usr_QVQfQps1I3a1gJYz2I3a' })

  const result = await request(t.context.serverUrl)
    .get('/assets/ast_0TYM7rs1OwP1gQRuCOwP')
    .set(authorizationHeaders)
    .expect(200)

  const asset = result.body

  t.is(asset.id, 'ast_0TYM7rs1OwP1gQRuCOwP')
  t.truthy(asset.metadata._private)
  t.truthy(asset.metadata._protected)
  t.truthy(asset.platformData._private)
  t.truthy(asset.platformData._protected)
})

test('finds an asset from a transaction (display protected namespace)', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['asset:read:all'], userId: 'usr_Y0tfQps1I3a1gJYz2I3a' })

  const result = await request(t.context.serverUrl)
    .get('/assets/ast_0TYM7rs1OwP1gQRuCOwP')
    .set(authorizationHeaders)
    .expect(200)

  const asset = result.body

  t.is(asset.id, 'ast_0TYM7rs1OwP1gQRuCOwP')
  t.falsy(asset.metadata._private)
  t.truthy(asset.metadata._protected)
  t.falsy(asset.platformData._private)
  t.truthy(asset.platformData._protected)
})

test('finds an asset with no relation (display neither private nor protected namespace)', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['asset:read:all'], userId: '43b7c248-4cca-43ff-95b6-f44a088e2ef2' })

  const result = await request(t.context.serverUrl)
    .get('/assets/ast_0TYM7rs1OwP1gQRuCOwP')
    .set(authorizationHeaders)
    .expect(200)

  const asset = result.body

  t.is(asset.id, 'ast_0TYM7rs1OwP1gQRuCOwP')
  t.falsy(asset.metadata._private)
  t.falsy(asset.metadata._protected)
  t.falsy(asset.platformData._private)
  t.falsy(asset.platformData._protected)
})

test('creates an asset', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['asset:create:all'] })

  const result = await request(t.context.serverUrl)
    .post('/assets')
    .set(authorizationHeaders)
    .send({
      name: 'Chevrolet',
      ownerId: '38006389-67bc-4552-a284-8f2dc76a25b8',
      assetTypeId: 'typ_RFpfQps1I3a1gJYz2I3a',
      customAttributes: {
        seatingCapacity: 5,
        freeTags: ['any tag', 'freeTag']
      },
      metadata: { dummy: true }
    })
    .expect(200)

  const asset = result.body

  t.is(asset.name, 'Chevrolet')
  t.is(asset.metadata.dummy, true)
})

test.serial('creating an asset without specifying an asset type will use the default one', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'asset:create:all',
      'assetType:read:all'
    ]
  })

  const { body: assetType } = await request(t.context.serverUrl)
    .get(`/asset-types/${defaultAssetTypeId}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(assetType.isDefault, true)

  const result = await request(t.context.serverUrl)
    .post('/assets')
    .set(authorizationHeaders)
    .send({
      name: 'Chevrolet',
      ownerId: '38006389-67bc-4552-a284-8f2dc76a25b8'
    })
    .expect(200)

  const asset = result.body

  t.is(asset.name, 'Chevrolet')
  t.is(asset.assetTypeId, defaultAssetTypeId)
})

// Must serially because it needs an empty platform environment
test.serial('creating an asset if there is no asset type will create one', async (t) => {
  const { context } = await createPlatform({ t, minimumFixtures: true })

  const authorizationHeaders = await getAccessTokenHeaders({
    t: { context },
    permissions: [
      'asset:create:all',
      'assetType:list:all'
    ]
  })

  const { body: { results: assetTypes } } = await request(t.context.serverUrl)
    .get('/asset-types')
    .set(authorizationHeaders)
    .expect(200)

  t.is(assetTypes.length, 0)

  const { body: asset } = await request(t.context.serverUrl)
    .post('/assets')
    .set(authorizationHeaders)
    .send({
      name: 'No asset type asset'
    })
    .expect(200)

  t.is(asset.name, 'No asset type asset')
  t.truthy(asset.assetTypeId)
})

test.serial('creating an asset without specifying an asset type will throw if there is no default asset type', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'asset:create:all',
      'assetType:read:all',
      'assetType:edit:all'
    ]
  })

  const { body: assetType } = await request(t.context.serverUrl)
    .get(`/asset-types/${defaultAssetTypeId}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(assetType.isDefault, true)

  // set to no default asset type
  await request(t.context.serverUrl)
    .patch(`/asset-types/${defaultAssetTypeId}`)
    .set(authorizationHeaders)
    .send({
      isDefault: false
    })
    .expect(200)

  await request(t.context.serverUrl)
    .post('/assets')
    .set(authorizationHeaders)
    .send({
      name: 'Chevrolet',
      ownerId: '38006389-67bc-4552-a284-8f2dc76a25b8'
    })
    .expect(400)

  // restore for other tests
  await request(t.context.serverUrl)
    .patch(`/asset-types/${defaultAssetTypeId}`)
    .set(authorizationHeaders)
    .send({
      isDefault: true
    })
    .expect(200)
})

test('creates an asset without ownerId', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['asset:create:all'] })

  const result = await request(t.context.serverUrl)
    .post('/assets')
    .set(authorizationHeaders)
    .send({
      name: 'Chevrolet',
      assetTypeId: 'typ_RFpfQps1I3a1gJYz2I3a',
      customAttributes: {
        seatingCapacity: 5,
        freeTags: ['any tag', 'freeTag']
      },
      metadata: { dummy: true }
    })
    .expect(200)

  const asset = result.body

  t.is(asset.name, 'Chevrolet')
  t.is(asset.metadata.dummy, true)
})

test('creates an asset with validated and active to true by default if not provided', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['asset:create:all'] })

  const result = await request(t.context.serverUrl)
    .post('/assets')
    .set(authorizationHeaders)
    .send({
      name: 'Chevrolet',
      ownerId: '38006389-67bc-4552-a284-8f2dc76a25b8',
      assetTypeId: 'typ_MWNfQps1I3a1gJYz2I3a',
      quantity: 0,
      metadata: { dummy: true }
    })
    .expect(200)

  const asset = result.body

  t.is(asset.name, 'Chevrolet')
  t.is(asset.active, true)
  t.is(asset.validated, true)
  t.is(asset.metadata.dummy, true)
})

test('creates an asset with provided validated and active (overrides defaults)', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['asset:create:all'] })

  const result = await request(t.context.serverUrl)
    .post('/assets')
    .set(authorizationHeaders)
    .send({
      name: 'Chevrolet',
      ownerId: '38006389-67bc-4552-a284-8f2dc76a25b8',
      assetTypeId: 'typ_MWNfQps1I3a1gJYz2I3a',
      quantity: 0,
      active: false,
      validated: false,
      metadata: { dummy: true }
    })
    .expect(200)

  const asset = result.body

  t.is(asset.name, 'Chevrolet')
  t.is(asset.active, false)
  t.is(asset.validated, false)
  t.is(asset.metadata.dummy, true)
})

// Must run serially due to default config change
// TODO: restore this test in upcoming commit
// Renaming assetsValidationAutomatic to 'automaticAssetValidation'
// Would be a breaking change if feature were documented…
/*
test.serial('creates an asset with validated to false if the config value assetsValidationAutomatic is false', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['asset:create:all', 'config:edit:all'] })

  await request(t.context.serverUrl)
    .patch('/config')
    .set(authorizationHeaders)
    .send({
      stelace: {
        assetsValidationAutomatic: false
      }
    })
    .expect(200)

  const result = await request(t.context.serverUrl)
    .post('/assets')
    .set(authorizationHeaders)
    .send({
      name: 'Chevrolet',
      ownerId: '38006389-67bc-4552-a284-8f2dc76a25b8',
      assetTypeId: 'typ_RFpfQps1I3a1gJYz2I3a',
      quantity: 0,
      metadata: { dummy: true }
    })
    .expect(200)

  const asset = result.body

  t.is(asset.name, 'Chevrolet')
  t.is(asset.validated, false)
  t.is(asset.metadata.dummy, true)
})
*/

test('creates an asset with zero quantity (isn’t bookable by default)', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['asset:create:all'] })

  const result = await request(t.context.serverUrl)
    .post('/assets')
    .set(authorizationHeaders)
    .send({
      name: 'Chevrolet',
      ownerId: '38006389-67bc-4552-a284-8f2dc76a25b8',
      assetTypeId: 'typ_RFpfQps1I3a1gJYz2I3a',
      quantity: 0,
      customAttributes: {
        seatingCapacity: 5
      },
      metadata: { dummy: true }
    })
    .expect(200)

  const asset = result.body

  t.is(asset.name, 'Chevrolet')
  t.is(asset.metadata.dummy, true)
})

test('updates an asset', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['asset:edit:all'] })

  const description = '🚀 Updating description, customAttributes, customPricingConfig and metadata'

  const { body: asset } = await request(t.context.serverUrl)
    .patch('/assets/ast_0TYM7rs1OwP1gQRuCOwP')
    .set(authorizationHeaders)
    .send({
      description,
      customAttributes: {
        seatingCapacity: 2
      },
      metadata: { editingPricingAndCustomAttributes: true }
    })
    .expect(200)

  t.is(asset.id, 'ast_0TYM7rs1OwP1gQRuCOwP')
  t.is(asset.description, description)
  t.is(asset.metadata.editingPricingAndCustomAttributes, true)
})

test('updates an asset without namespaces with api keys', async (t) => {
  const result = await request(t.context.serverUrl)
    .patch('/assets/ast_0TYM7rs1OwP1gQRuCOwP')
    .set({
      'x-api-key': 'seck_live_iuJzTKo5wumuE1imSjmcgimR',
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      active: true,
      validated: true
    })
    .expect(200)

  const asset = result.body

  t.is(asset.id, 'ast_0TYM7rs1OwP1gQRuCOwP')
})

test('update own asset private namespace', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['asset:edit:all'],
    userId: 'usr_QVQfQps1I3a1gJYz2I3a'
  })

  const result = await request(t.context.serverUrl)
    .patch('/assets/ast_0TYM7rs1OwP1gQRuCOwP')
    .set(authorizationHeaders)
    .send({
      metadata: {
        _private: {
          color: 'blue'
        },
        notPrivate: true
      }
    })
    .expect(200)

  const user = result.body

  t.is(user.id, 'ast_0TYM7rs1OwP1gQRuCOwP')
  t.is(user.metadata._private.color, 'blue')
  t.is(user.metadata.notPrivate, true)
})

test('cannot update the asset private namespace if it isn\'t own', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['user:edit:all'] })

  await request(t.context.serverUrl)
    .patch('/assets/ast_0TYM7rs1OwP1gQRuCOwP')
    .set(authorizationHeaders)
    .send({
      metadata: {
        _private: {
          color: 'blue'
        },
        dummy: true
      }
    })
    .expect(403)

  t.pass()
})

test('updates an asset with platform data', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'asset:edit:all',
      'platformData:edit:all'
    ],
    readNamespaces: ['custom'],
    editNamespaces: ['custom']
  })

  const patchPayload = {
    name: 'Asset Updated with platform data',
    metadata: {
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
  }

  const { body: asset } = await request(t.context.serverUrl)
    .patch('/assets/ast_0TYM7rs1OwP1gQRuCOwP')
    .set(authorizationHeaders)
    .send(patchPayload)
    .expect(200)

  t.is(asset.metadata._custom.test, true)
  t.is(asset.metadata.metadataOnly, 'notPlatformData') // merged fixture metadata
  t.falsy(asset.metadata.platformDataOnly) // check for cross-data leaks

  t.is(asset.platformData.test, true)
  t.is(asset.platformData._custom.ok, true)
  t.falsy(asset.platformData.metadataOnly) // check for cross-data leaks
  t.is(asset.platformData.platformDataOnly, 'notMetadata') // & cross-data overwrite

  patchPayload.platformData._extra = {}
  patchPayload.name = 'Asset platformData Updated with forbidden extra namespace'

  await request(t.context.serverUrl)
    .patch('/assets/ast_0TYM7rs1OwP1gQRuCOwP')
    .set(authorizationHeaders)
    .send(patchPayload)
    .expect(403)
})

test('removes an asset', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'asset:read:all',
      'asset:create:all',
      'asset:remove:all'
    ]
  })

  const { body: asset } = await request(t.context.serverUrl)
    .post('/assets')
    .set(authorizationHeaders)
    .send({
      name: 'Asset to remove',
      assetTypeId: 'typ_RFpfQps1I3a1gJYz2I3a'
    })
    .expect(200)

  const result = await request(t.context.serverUrl)
    .delete(`/assets/${asset.id}`)
    .set(authorizationHeaders)
    .expect(200)

  const payload = result.body

  t.is(payload.id, asset.id)

  await request(t.context.serverUrl)
    .get(`/assets/${asset.id}`)
    .set(authorizationHeaders)
    .expect(404)
})

test('cannot remove an asset that have pending transactions', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['asset:remove:all'] })

  await request(t.context.serverUrl)
    .delete('/assets/ast_0TYM7rs1OwP1gQRuCOwP')
    .set(authorizationHeaders)
    .expect(422)

  t.pass()
})

// ////////// //
// VALIDATION //
// ////////// //

test('fails to create an asset if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .post('/assets')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // missing required parameters
  result = await request(t.context.serverUrl)
    .post('/assets')
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
    .post('/assets')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: true,
      description: true,
      categoryId: true,
      ownerId: true,
      validated: 'invalid',
      active: 'invalid',
      locations: true,
      assetTypeId: true,
      quantity: 'invalid',
      price: 'invalid',
      currency: true,
      customAttributes: true,
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"name" must be a string'))
  t.true(error.message.includes('"description" must be a string'))
  t.true(error.message.includes('"categoryId" must be a string'))
  t.true(error.message.includes('"ownerId" must be a string'))
  t.true(error.message.includes('"validated" must be a boolean'))
  t.true(error.message.includes('"active" must be a boolean'))
  t.true(error.message.includes('"locations" must be an array'))
  t.true(error.message.includes('"assetTypeId" must be a string'))
  t.true(error.message.includes('"quantity" must be a number'))
  t.true(error.message.includes('"price" must be a number'))
  t.true(error.message.includes('"currency" must be a string'))
  t.true(error.message.includes('"customAttributes" must be of type object'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

test('fails to update an asset if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .patch('/assets/ast_0TYM7rs1OwP1gQRuCOwP')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .patch('/assets/ast_0TYM7rs1OwP1gQRuCOwP')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: true,
      description: true,
      categoryId: true,
      validated: 'invalid',
      active: 'invalid',
      locations: true,
      assetTypeId: true,
      quantity: 'invalid',
      price: 'invalid',
      currency: true,
      customAttributes: true,
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"name" must be a string'))
  t.true(error.message.includes('"description" must be a string'))
  t.true(error.message.includes('"categoryId" must be a string'))
  t.true(error.message.includes('"validated" must be a boolean'))
  t.true(error.message.includes('"active" must be a boolean'))
  t.true(error.message.includes('"locations" must be an array'))
  t.true(error.message.includes('"assetTypeId" must be a string'))
  t.true(error.message.includes('"quantity" must be a number'))
  t.true(error.message.includes('"price" must be a number'))
  t.true(error.message.includes('"currency" must be a string'))
  t.true(error.message.includes('"customAttributes" must be of type object'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

// ////// //
// EVENTS //
// ////// //

// Event tests must run serially before the other tests
test.serial('generates asset__* events', async (t) => {
  const { Event } = await getModels({
    platformId: t.context.platformId,
    env: t.context.env
  })
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'asset:create:all',
      'asset:edit:all',
      'asset:remove:all',
      'event:list:all'
    ],
    readNamespaces: ['custom'],
    editNamespaces: ['custom']
  })

  const { body: asset } = await request(t.context.serverUrl)
    .post('/assets')
    .set(authorizationHeaders)
    .send({
      name: 'Created Event Test Asset',
      ownerId: '38006389-67bc-4552-a284-8f2dc76a25b8',
      assetTypeId: 'typ_RFpfQps1I3a1gJYz2I3a',
      active: true,
      validated: false,
      customAttributes: {
        seatingCapacity: 5
      },
      metadata: {
        test1: true,
        _custom: {
          hasDataInNamespace: true
        }
      }
    })
    .expect(200)

  const patchPayload = {
    name: 'Updated Event Test Asset, after update',
    assetTypeId: 'typ_MWNfQps1I3a1gJYz2I3a',
    categoryId: 'ctgy_N1FQps1I3a1gJYz2I3a',
    description: 'I have a new description',
    quantity: 2,
    price: 10,
    locations: [{ latitude: 30, longitude: 30 }],
    active: false,
    validated: true,
    customAttributes: {
      automaticTransmission: true,
      options: ['convertible']
    },
    metadata: {
      test2: true,
      _custom: {
        hasAdditionalDataInNamespace: true
      }
    }
  }

  const { body: assetUpdated } = await request(t.context.serverUrl)
    .patch(`/assets/${asset.id}`)
    .set(authorizationHeaders)
    .send(patchPayload)
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, testEventDelay))

  const { body: { results: events } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders)
    .expect(200)

  const assetCreatedEvent = events.find(event => {
    return event.type === 'asset__created' &&
      event.objectId === asset.id
  })
  await testEventMetadata({ event: assetCreatedEvent, object: asset, t })
  t.is(assetCreatedEvent.object.name, asset.name)
  t.is(assetCreatedEvent.object.metadata._custom.hasDataInNamespace, true)
  t.not(assetCreatedEvent.object.metadata._custom.hasAdditionalDataInNamespace, true)

  const assetUpdatedEvent = getObjectEvent({
    events,
    eventType: 'asset__updated',
    objectId: assetUpdated.id
  })
  await testEventMetadata({
    event: assetUpdatedEvent,
    object: assetUpdated,
    t,
    patchPayload
  })
  t.is(assetUpdatedEvent.object.name, assetUpdated.name)
  t.is(assetUpdatedEvent.object.metadata._custom.hasDataInNamespace, true)
  t.is(assetUpdatedEvent.object.metadata._custom.hasAdditionalDataInNamespace, true)

  const eventsTypesToTestAfterUpdate = [
    'asset__name_changed',
    'asset__description_changed',
    'asset__category_switched',
    'asset__type_switched',
    'asset__custom_attribute_changed',
    'asset__locations_changed',
    'asset__quantity_changed',
    'asset__pricing_changed',
    'asset__validated',
    'asset__deactivated'
  ]

  const eventsAfterUpdate = {}
  eventsTypesToTestAfterUpdate.forEach(eventType => {
    eventsAfterUpdate[eventType] = getObjectEvent({
      events,
      eventType,
      objectId: assetUpdated.id
    })
  })

  const config = Event.getUpdatedEventDeltasConfig('asset')
  const deltas = Event.getUpdatedEventDeltas(config, patchPayload, asset)

  for (const eventType in eventsAfterUpdate) {
    const event = eventsAfterUpdate[eventType]
    if (!event) t.fail(`No ${eventType} event found`)

    await testEventMetadata({ event, object: assetUpdated, t, patchPayload: deltas[eventType] })
  }

  await request(t.context.serverUrl)
    .patch(`/assets/${asset.id}`)
    .set(authorizationHeaders)
    .send({ active: true })
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, testEventDelay))

  const { body: { results: eventsAfterActivation } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders)
    .expect(200)

  const assetActivatedEvent = getObjectEvent({
    events: eventsAfterActivation,
    eventType: 'asset__activated',
    objectId: assetUpdated.id
  })

  t.truthy(assetActivatedEvent)

  await request(t.context.serverUrl)
    .delete(`/assets/${assetUpdated.id}`)
    .set(authorizationHeaders)
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, testEventDelay))

  const { body: { results: eventsAfterDelete } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders)
    .expect(200)

  const assetDeletedEvent = getObjectEvent({
    events: eventsAfterDelete,
    eventType: 'asset__deleted',
    objectId: assetUpdated.id
  })
  await testEventMetadata({ event: assetDeletedEvent, object: assetUpdated, t })
  t.is(assetUpdatedEvent.object.name, assetUpdated.name)
  t.is(assetUpdatedEvent.object.metadata._custom.hasDataInNamespace, true)
  t.is(assetUpdatedEvent.object.metadata._custom.hasAdditionalDataInNamespace, true)
})

// //////// //
// VERSIONS //
// //////// //

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('2019-05-20: list assets with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['asset:list:all']
  })

  await checkOffsetPaginationScenario({
    t,
    endpointUrl: '/assets',
    authorizationHeaders,
  })
})

test('2019-05-20: list assets with id filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['asset:list:all']
  })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/assets?id=ast_0TYM7rs1OwP1gQRuCOwP')
    .set(authorizationHeaders)
    .expect(200)

  checkOffsetPaginatedListObject(t, obj)
  t.is(obj.nbResults, 1)
})
