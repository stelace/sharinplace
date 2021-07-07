require('dotenv').config()

const test = require('ava')
const request = require('supertest')
const _ = require('lodash')

const { before, beforeEach, after } = require('../../lifecycle')
const { getAccessToken, getAccessTokenHeaders, getSystemKey } = require('../../auth')
const {
  getObjectEvent,
  testEventMetadata,

  checkCursorPaginationScenario,
  checkCursorPaginatedListObject,

  checkOffsetPaginationScenario,
  checkOffsetPaginatedListObject,

  checkFilters,
} = require('../../util')
const { encodeBase64 } = require('../../../src/util/encoding')

test.before(async t => {
  await before({
    name: 'apiKey',
    platformId: 2, // set the platformId to 2 because of the api key information
    env: 'test'
  })(t)
  await beforeEach()(t)
})
// test.beforeEach(beforeEach()) // Concurrent tests are much faster
test.after(after())

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('list api keys with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['apiKey:list:all'] })

  await checkCursorPaginationScenario({
    t,
    endpointUrl: '/api-keys',
    authorizationHeaders,
  })
})

// use serial because no changes must be made during the check
test.serial('check list filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['apiKey:list:all'] })

  await checkFilters({
    t,
    endpointUrl: '/api-keys',
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
        prop: 'type',
        customTestValues: ['seck', 'pubk', 'cntk', 'custom'],
        customExactValueFilterCheck: (obj, value) => obj.key.startsWith(value),
      }
      // `reveal` are tested in other tests
    ],
  })
})

test('list api keys with api key', async (t) => {
  const { body: obj } = await request(t.context.serverUrl)
    .get('/api-keys')
    .set({ authorization: `Basic ${encodeBase64('seck_test_wakWA41rBTUXs1Y5pNRjeY5o:')}` })
    .expect(200)

  checkCursorPaginatedListObject(t, obj)
})

test('rejects invalid api key format with 401 and www-authenticate header', async (t) => {
  const error = await request(t.context.serverUrl)
    .get('/api-keys')
    .set({
      // old api key uuid format
      authorization: 'Basic f7d82664-b68a-4c2a-8763-56a2141e5e47',

      // should use the platformId with the old format api key (no information in it)
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(401)

  t.truthy(error.headers['www-authenticate'])
  t.regex(error.headers['www-authenticate'], /Basic realm=/)
  t.regex(error.headers['www-authenticate'], /Bearer/)
  t.regex(error.headers['www-authenticate'], /Stelace-v1/)
})

test('list api keys with a given type', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['apiKey:list:all'] })

  const { body: { results: publishableApiKeys } } = await request(t.context.serverUrl)
    .get('/api-keys?type=pubk')
    .set(authorizationHeaders)
    .expect(200)

  t.true(publishableApiKeys.every(p => p.key.startsWith('pubk')))

  const { body: { results: secretApiKeys } } = await request(t.context.serverUrl)
    .get('/api-keys?type=seck')
    .set(authorizationHeaders)
    .expect(200)

  t.true(secretApiKeys.every(s => s.key.startsWith('seck')))

  await request(t.context.serverUrl)
    .get('/api-keys?type=tooLongType')
    .set(authorizationHeaders)
    .expect(400)
})

test('creates an api key with custom type', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['apiKey:create:all'] })

  const { body: customKey } = await request(t.context.serverUrl)
    .post('/api-keys')
    .set(authorizationHeaders)
    .send({
      name: 'New custom api key',
      roles: ['dev'],
      permissions: ['category:create:all'],
      type: 'custom1',
      metadata: { custom: true }
    })
    .expect(200)

  t.true(customKey.key.startsWith('custom1'))
  t.true(customKey.metadata.custom)
})

test('finds an api key', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['apiKey:read:all'] })

  const result = await request(t.context.serverUrl)
    .get('/api-keys/apik_aHZQps1I3b1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  const apiKey = result.body

  t.is(apiKey.id, 'apik_aHZQps1I3b1gJYz2I3a')
  t.is(apiKey.name, 'Main')
})

test('finds an api key with api key', async (t) => {
  const result = await request(t.context.serverUrl)
    .get('/api-keys/apik_aHZQps1I3b1gJYz2I3a')
    .set({ authorization: `Basic ${encodeBase64('seck_test_wakWA41rBTUXs1Y5pNRjeY5o:')}` })
    .expect(200)

  const apiKey = result.body

  t.is(apiKey.id, 'apik_aHZQps1I3b1gJYz2I3a')
  t.is(apiKey.name, 'Main')
})

test('creates an api key of publishable type by default', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['apiKey:create:all'] })

  const result = await request(t.context.serverUrl)
    .post('/api-keys')
    .set(authorizationHeaders)
    .send({
      name: 'New api key',
      roles: ['dev'], // overridden for now, may throw in the future
      permissions: ['category:create:all'], // idem
      metadata: { dummy: true }
    })
    .expect(200)

  const apiKey = result.body

  t.is(apiKey.metadata.dummy, true)
  t.deepEqual(apiKey.roles, ['public'])
  t.deepEqual(apiKey.permissions, [])
  t.true(apiKey.key.startsWith('pubk_')) // by default the api key is a publishable key
})

test('creates an api key with a role other than dev', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['apiKey:create:all'] })

  const result = await request(t.context.serverUrl)
    .post('/api-keys')
    .set(authorizationHeaders)
    .send({
      name: 'New api key',
      roles: ['public'],
      metadata: { dummy: true }
    })
    .expect(200)

  const apiKey = result.body

  t.is(apiKey.metadata.dummy, true)
})

test('fails to create an api key with a unknown role', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['apiKey:create:all'] })

  await request(t.context.serverUrl)
    .post('/api-keys')
    .set(authorizationHeaders)
    .send({
      name: 'New api key',
      roles: ['unknownRole'],
      metadata: { dummy: true }
    })
    .expect(422)

  t.pass()
})

test('creates an api key with api key', async (t) => {
  const result = await request(t.context.serverUrl)
    .post('/api-keys')
    .set({ authorization: `Basic ${encodeBase64('seck_test_wakWA41rBTUXs1Y5pNRjeY5o:')}` })
    .send({
      name: 'New api key',
      roles: ['dev'],
      permissions: ['category:create:all'],
      metadata: { dummy: true }
    })
    .expect(200)

  const apiKey = result.body

  t.is(apiKey.metadata.dummy, true)
})

test('use the publishable key in Authorization header to identify the platform ID', async (t) => {
  const accessToken = await getAccessToken({
    permissions: [
      'apiKey:read:all',
      'apiKey:create:all'
    ]
  })

  const date = new Date().getTime()

  const { body: publishableKey } = await request(t.context.serverUrl)
    .post('/api-keys')
    .set({
      authorization: `Bearer ${accessToken}`,
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: 'My publishable key',
      type: 'pubk',
      metadata: { date }
    })
    .expect(200)

  t.is(publishableKey.metadata.date, date)

  const { body: afterPublishableKey } = await request(t.context.serverUrl)
    .get(`/api-keys/${publishableKey.id}`)
    .set({
      // use the publishable key to identify the platform ID
      // Custom authorization scheme, not case sensitive
      authorization: `Stelace-V1 apiKey=${publishableKey.key}, token=${accessToken}`
    })
    .expect(200)

  t.is(afterPublishableKey.id, publishableKey.id)
  t.is(afterPublishableKey.metadata.date, date)

  const { body: afterPublishableKeyLowerCase } = await request(t.context.serverUrl)
    .get(`/api-keys/${publishableKey.id}`)
    .set({
      // Custom authorization scheme, not case sensitive
      authorization: `stelace-v1 apikey=${publishableKey.key}, token=${accessToken}`
    })
    .expect(200)

  t.is(afterPublishableKeyLowerCase.id, publishableKey.id)
  t.is(afterPublishableKeyLowerCase.metadata.date, date)
})

test('updates an api key', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['apiKey:edit:all'] })

  const result = await request(t.context.serverUrl)
    .patch('/api-keys/apik_A30Gye1mER1iEyNAmEQ')
    .set(authorizationHeaders)
    .send({
      roles: ['dev'],
      permissions: ['category:create:all'],
      metadata: { dummy: true }
    })
    .expect(200)

  const apiKey = result.body

  t.is(apiKey.id, 'apik_A30Gye1mER1iEyNAmEQ')
  t.is(apiKey.metadata.dummy, true)
})

test('updates an api key with api key', async (t) => {
  const result = await request(t.context.serverUrl)
    .patch('/api-keys/apik_A30Gye1mER1iEyNAmEQ')
    .set({ 'x-api-key': 'seck_test_wakWA41rBTUXs1Y5pNRjeY5o' })
    .send({
      roles: ['dev'],
      permissions: ['category:create:all'],
      metadata: { dummy: true }
    })
    .expect(200)

  const apiKey = result.body

  t.is(apiKey.id, 'apik_A30Gye1mER1iEyNAmEQ')
  t.is(apiKey.metadata.dummy, true)
})

test('updates an api key with api key and loses access to some endpoints', async (t) => {
  const authorizationHeaders = {
    authorization: `Basic ${encodeBase64('seck_test_RS1OQ21Bosuoe1CJDh5cr9vUHDQ1hCJC:')}`
  }

  await request(t.context.serverUrl)
    .get('/categories')
    .set(authorizationHeaders)
    .expect(200)

  const result = await request(t.context.serverUrl)
    .patch('/api-keys/apik_tnEpBe15gs1hYQox5gr')
    .set(authorizationHeaders)
    .send({
      roles: [],
      permissions: [],
      metadata: { dummy: true }
    })
    .expect(200)

  const apiKey = result.body

  t.is(apiKey.id, 'apik_tnEpBe15gs1hYQox5gr')
  t.is(apiKey.metadata.dummy, true)

  await request(t.context.serverUrl)
    .get('/categories')
    .set(authorizationHeaders)
    .expect(403)
})

test('updates an api key with a role other than dev', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['apiKey:edit:all'] })

  const result = await request(t.context.serverUrl)
    .patch('/api-keys/apik_A30Gye1mER1iEyNAmEQ')
    .set(authorizationHeaders)
    .send({
      roles: ['public'],
      metadata: { dummy: true }
    })
    .expect(200)

  const apiKey = result.body

  t.is(apiKey.id, 'apik_A30Gye1mER1iEyNAmEQ')
  t.is(apiKey.metadata.dummy, true)
})

test('fails to update an api key with a unknown role', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['apiKey:edit:all'] })

  await request(t.context.serverUrl)
    .patch('/api-keys/apik_A30Gye1mER1iEyNAmEQ')
    .set(authorizationHeaders)
    .send({
      roles: ['unknownRole'],
      metadata: { dummy: true }
    })
    .expect(422)

  t.pass()
})

test('removes an api key via access token', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'apiKey:read:all',
      'apiKey:create:all',
      'apiKey:remove:all'
    ]
  })

  const { body: apiKey } = await request(t.context.serverUrl)
    .post('/api-keys')
    .set(authorizationHeaders)
    .send({
      name: 'New custom',
      roles: ['dev'],
      type: 'customKey'
    })
    .expect(200)

  await request(t.context.serverUrl)
    .get(`/api-keys/${apiKey.id}`)
    .set(authorizationHeaders)
    .expect(200)

  const result = await request(t.context.serverUrl)
    .delete(`/api-keys/${apiKey.id}`)
    .set(authorizationHeaders)
    .expect(200)

  const payload = result.body

  t.is(payload.id, apiKey.id)

  await request(t.context.serverUrl)
    .get(`/api-keys/${apiKey.id}`)
    .set(authorizationHeaders)
    .expect(404)
})

test('removes an api key via api key', async (t) => {
  const authorizationHeaders = {
    authorization: `Basic ${encodeBase64('seck_test_wakWA41rBTUXs1Y5pNRjeY5o:')}`
  }

  const { body: apiKey } = await request(t.context.serverUrl)
    .post('/api-keys')
    .set(authorizationHeaders)
    .send({
      name: 'New custom',
      roles: ['dev'],
      type: 'customKey'
    })
    .expect(200)

  await request(t.context.serverUrl)
    .get(`/api-keys/${apiKey.id}`)
    .set(authorizationHeaders)
    .expect(200)

  const result = await request(t.context.serverUrl)
    .delete(`/api-keys/${apiKey.id}`)
    .set(authorizationHeaders)
    .expect(200)

  const payload = result.body

  t.is(payload.id, apiKey.id)

  await request(t.context.serverUrl)
    .get(`/api-keys/${apiKey.id}`)
    .set(authorizationHeaders)
    .expect(404)
})

// ////////// //
// VALIDATION //
// ////////// //

test('fails to create an api key if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .post('/api-keys')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // missing required parameters
  result = await request(t.context.serverUrl)
    .post('/api-keys')
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
    .post('/api-keys')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: true,
      type: '@custom',
      roles: true,
      permissions: true,
      readNamespaces: true,
      editNamespaces: true,
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"name" must be a string'))
  t.regex(error.message, /"type" .* fails to match/)
  t.true(error.message.includes('"roles" must be an array'))
  t.true(error.message.includes('"permissions" must be an array'))
  t.true(error.message.includes('"readNamespaces" must be an array'))
  t.true(error.message.includes('"editNamespaces" must be an array'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

test('fails to update an api key if missing or invalid parameters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['apiKey:create:all'] })

  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .patch('/api-keys/apik_aHZQps1I3b1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .patch('/api-keys/apik_aHZQps1I3b1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      name: true,
      roles: true,
      permissions: true,
      readNamespaces: true,
      editNamespaces: true,
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"name" must be a string'))
  t.true(error.message.includes('"roles" must be an array'))
  t.true(error.message.includes('"permissions" must be an array'))
  t.true(error.message.includes('"readNamespaces" must be an array'))
  t.true(error.message.includes('"editNamespaces" must be an array'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

test('secret key should be obfuscated', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'apiKey:read:all',
      'apiKey:create:all'
    ]
  })

  const { body: apiKey } = await request(t.context.serverUrl)
    .post('/api-keys')
    .set(authorizationHeaders)
    .send({
      name: 'New secret api key',
      type: 'seck'
    })
    .expect(200)

  const { body: foundApiKey } = await request(t.context.serverUrl)
    .get(`/api-keys/${apiKey.id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(apiKey.key !== foundApiKey.key) // obfuscated
  // Ensure key is obfuscated
  t.true(foundApiKey.key.includes('x'.repeat(12)))
})

test('secret key can be revealed if the request is from system', async (t) => {
  const systemKey = getSystemKey()

  const { body: apiKey } = await request(t.context.serverUrl)
    .post('/api-keys')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env,
      'x-stelace-system-key': systemKey
    })
    .send({
      name: 'New secret api key',
      type: 'seck'
    })
    .expect(200)

  const { body: obfuscatedApiKey } = await request(t.context.serverUrl)
    .get(`/api-keys/${apiKey.id}`)
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env,
      'x-stelace-system-key': systemKey
    })
    .expect(200)

  // Ensure key is obfuscated after 'seck_test_' prefix
  t.true(obfuscatedApiKey.key.includes('x'.repeat(12)))

  const { body: revealedApiKey } = await request(t.context.serverUrl)
    .get(`/api-keys/${apiKey.id}?reveal=1`)
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env,
      'x-stelace-system-key': systemKey
    })
    .expect(200)

  t.true(apiKey.key === revealedApiKey.key) // non obfuscated
})

test('secret key can be revealed if the request is from Stelace auth token', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'apiKey:read:all',
      'apiKey:create:all'
    ]
  })

  const { body: apiKey } = await request(t.context.serverUrl)
    .post('/api-keys')
    .set(authorizationHeaders)
    .send({
      name: 'New secret api key',
      type: 'seck'
    })
    .expect(200)

  const { body: obfuscatedApiKey } = await request(t.context.serverUrl)
    .get(`/api-keys/${apiKey.id}`)
    .set(authorizationHeaders)
    .expect(200)

  // Ensure key is obfuscated
  t.true(obfuscatedApiKey.key.includes('x'.repeat(12)))

  const { body: revealedApiKey } = await request(t.context.serverUrl)
    .get(`/api-keys/${apiKey.id}?reveal=1`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(apiKey.key === revealedApiKey.key) // non obfuscated
})

test('secret key cannot be revealed if the request is from Stelace auth token and there is not enough permissions', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'apiKey:read:all'
    ]
  })

  const { body: obfuscatedApiKey } = await request(t.context.serverUrl)
    .get('/api-keys/apik_aHZQps1I3b1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  // Ensure key is obfuscated
  t.true(obfuscatedApiKey.key.includes('x'.repeat(12)))

  await request(t.context.serverUrl)
    .get('/api-keys/apik_aHZQps1I3b1gJYz2I3a?reveal=1')
    .set(authorizationHeaders)
    .expect(403)
})

// ////// //
// EVENTS //
// ////// //

// Event tests must run serially before the other tests
test.serial('generates api_key__* events', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'apiKey:create:all',
      'apiKey:edit:all',
      'apiKey:remove:all',
      'event:list:all'
    ]
  })

  const { body: apiKey } = await request(t.context.serverUrl)
    .post('/api-keys')
    .set(authorizationHeaders)
    .send({
      name: 'Created Event Test Api Key',
      type: 'eventTest',
      roles: ['dev'],
      permissions: ['asset:create:all']
    })
    .expect(200)

  const patchPayload = {
    name: 'Updated Event Test Api Key, after update',
    roles: ['dev', 'custom'],
    permissions: ['asset:create:all', 'category:create:all']
  }

  const { body: apiKeyUpdated } = await request(t.context.serverUrl)
    .patch(`/api-keys/${apiKey.id}`)
    .set(authorizationHeaders)
    .send(patchPayload)
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 300))

  const { body: { results: events } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders)
    .expect(200)

  const apiKeyCreatedEvent = getObjectEvent({
    events,
    eventType: 'api_key__created',
    objectId: apiKey.id
  })
  await testEventMetadata({ event: apiKeyCreatedEvent, object: apiKey, t })
  t.is(apiKeyCreatedEvent.object.name, apiKey.name)
  // Ensure custom key is obfuscated
  t.truthy(apiKeyCreatedEvent.object.key.includes('x'.repeat(12)))
  t.is(_.difference(apiKeyCreatedEvent.object.roles, apiKey.roles).length, 0)

  const apiKeyUpdatedEvent = getObjectEvent({
    events,
    eventType: 'api_key__updated',
    objectId: apiKeyUpdated.id
  })
  await testEventMetadata({ event: apiKeyUpdatedEvent, object: apiKeyUpdated, t, patchPayload })
  t.is(apiKeyUpdatedEvent.object.name, apiKeyUpdated.name)
  t.truthy(apiKeyUpdatedEvent.object.key.includes('x'.repeat(12)))
  t.is(_.difference(apiKeyUpdatedEvent.object.roles, apiKeyUpdated.roles).length, 0)
  t.not(_.difference(apiKeyUpdatedEvent.object.roles, apiKey.roles).length, 0)

  await request(t.context.serverUrl)
    .delete(`/api-keys/${apiKeyUpdated.id}`)
    .set(authorizationHeaders)
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 300))

  const { body: { results: eventsAfterDelete } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders)
    .expect(200)

  const apiKeyDeletedEvent = eventsAfterDelete.find(event => {
    return event.type === 'api_key__deleted' &&
      event.objectId === apiKeyUpdated.id
  })
  await testEventMetadata({ event: apiKeyDeletedEvent, object: apiKeyUpdated, t })
})

// //////// //
// VERSIONS //
// //////// //

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('2019-05-20: list api keys with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['apiKey:list:all']
  })

  await checkOffsetPaginationScenario({
    t,
    endpointUrl: '/api-keys',
    authorizationHeaders,
  })
})

test('2019-05-20: list api keys with id filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['apiKey:list:all']
  })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/api-keys?id=apik_aHZQps1I3b1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  checkOffsetPaginatedListObject(t, obj)
  t.is(obj.nbResults, 1)
})

test('2019-05-20: list api keys with api key', async (t) => {
  const { body: obj } = await request(t.context.serverUrl)
    .get('/api-keys')
    .set({
      authorization: `Basic ${encodeBase64('seck_test_wakWA41rBTUXs1Y5pNRjeY5o:')}`,
      'x-stelace-version': '2019-05-20'
    })
    .expect(200)

  checkOffsetPaginatedListObject(t, obj)
})
