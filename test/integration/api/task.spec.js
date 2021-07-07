require('dotenv').config()

const test = require('ava')
const request = require('supertest')
const ms = require('ms')
const _ = require('lodash')

const { before, beforeEach, after } = require('../../lifecycle')
const { getAccessTokenHeaders, getApiKey } = require('../../auth')
const {
  computeDate,

  checkOffsetPaginationScenario,
  checkOffsetPaginatedListObject,

  checkCursorPaginationScenario,
  checkCursorPaginatedListObject,

  checkFilters,
} = require('../../util')

const { getRoundedDate } = require('../../../src/util/time')
const { encodeBase64 } = require('../../../src/util/encoding')

test.before(async t => {
  // disable signal because there is time manipulation in this test suite
  // that can cause signal tests to fail
  await before({ name: 'task', enableSignal: false })(t)
  await beforeEach()(t)
})
// test.beforeEach(beforeEach()) // Concurrent tests are much faster
test.after(after())

const restoreClock = async (t, duration = 3000) => {
  // restore the clock so we can use `setTimeout` to wait for event generation
  t.context.server._stopCrons()
  t.context.server._clock.restore()
  t.context.server._startCrons()

  // use a delay here to wait event creation
  // because any async cron logic will be performed after the clock restore
  await new Promise(resolve => setTimeout(resolve, duration))
}

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('list tasks with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['task:list:all'] })

  await checkCursorPaginationScenario({
    t,
    endpointUrl: '/tasks',
    authorizationHeaders,
    checkResultsFn: (t, task) => {
      t.truthy(task.id)
      t.true(_.isString(task.eventType))
    }
  })
})

test('list tasks with id filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['task:list:all'] })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/tasks?id=task_4bJEZe1bA91i7IQYbA8')
    .set(authorizationHeaders)
    .expect(200)

  checkCursorPaginatedListObject(t, obj)
  t.is(obj.results.length, 1)
})

test('list tasks with advanced filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['task:list:all'] })

  const { body: { results: tasks1 } } = await request(t.context.serverUrl)
    .get('/tasks?eventObjectId=ast_2l7fQps1I3a1gJYz2I3a,ast_lCfxJNs10rP1g2Mww0rP')
    .set(authorizationHeaders)
    .expect(200)

  tasks1.forEach(task => {
    t.true(['ast_2l7fQps1I3a1gJYz2I3a', 'ast_lCfxJNs10rP1g2Mww0rP'].includes(task.eventObjectId))
  })

  const { body: { results: tasks2 } } = await request(t.context.serverUrl)
    .get('/tasks?eventObjectId=ast_2l7fQps1I3a1gJYz2I3a&active=true&eventType=asset_timeout')
    .set(authorizationHeaders)
    .expect(200)

  tasks2.forEach(task => {
    t.true(['ast_2l7fQps1I3a1gJYz2I3a'].includes(task.eventObjectId))
    t.is(task.eventType, 'asset_timeout')
    t.true(task.active)
  })
})

// use serial because no changes must be made during the check
test.serial('check list filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['task:list:all'] })

  await checkFilters({
    t,
    endpointUrl: '/tasks',
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
        prop: 'eventType',
        isArrayFilter: true,
      },
      {
        prop: 'eventObjectId',
        isArrayFilter: true,
      },
      {
        prop: 'active',
        customListValues: [true, false],
      },
    ],
  })
})

test('finds a task', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['task:read:all'] })

  const { body: task } = await request(t.context.serverUrl)
    .get('/tasks/task_4bJEZe1bA91i7IQYbA8')
    .set(authorizationHeaders)
    .expect(200)

  t.is(task.id, 'task_4bJEZe1bA91i7IQYbA8')
})

test('creates a task with an execution date', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['task:create:all'] })

  const now = new Date().toISOString()

  const executionDate = computeDate(now, '1d')

  const { body: task } = await request(t.context.serverUrl)
    .post('/tasks')
    .set(authorizationHeaders)
    .send({
      executionDate,
      eventType: 'asset_timeout',
      eventObjectId: 'ast_2l7fQps1I3a1gJYz2I3a',
      eventMetadata: { test: true },
      metadata: { dummy: true }
    })
    .expect(200)

  t.truthy(task.id)
  t.is(task.executionDate, getRoundedDate(executionDate, { nbMinutes: 1 }))
  t.is(task.eventType, 'asset_timeout')
  t.is(task.eventObjectId, 'ast_2l7fQps1I3a1gJYz2I3a')
  t.is(task.eventMetadata.test, true)
  t.is(task.metadata.dummy, true)
})

// Must run serially because the test manipulates time
test.serial('creates a task with an execution date and checks events', async (t) => {
  if (!t.context.server) {
    // can happen if the server is run outside of AVA process (e.g. `npm run test:uniqueserver`)
    console.log('Warning: This test cannot be running because instance server is not accessible to manipulate time')
    t.pass()
    return
  }

  // use an api key without roles instead of access token for authentication
  // because roles checking doesn't work well with time manipulation
  // (server run indefinitely)
  const apiKey = await getApiKey({
    t,
    type: 'custom',
    permissions: [
      'task:create:all',
      'event:list:all'
    ]
  })

  // mock timing functions and restart crons so the mock can work
  t.context.server._stopCrons()
  t.context.server._initClock({
    now: new Date(),
    toFake: ['Date', 'setTimeout'],
    shouldAdvanceTime: true
  })
  t.context.server._startCrons()

  const authorizationHeaders = {
    authorization: `Basic ${encodeBase64(apiKey.key + ':')}`
  }

  const eventType = 'asset_timeout'
  const assetId = 'ast_2l7fQps1I3a1gJYz2I3a'

  const now = new Date().toISOString()

  // do not use a long duration, because crons function logic will trigger every simulated minute
  const executionDate = computeDate(now, '1h')

  const { body: { results: beforeEvents } } = await request(t.context.serverUrl)
    .get(`/events?type=${eventType}&objectId=${assetId}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(beforeEvents.length, 0)

  const { body: task } = await request(t.context.serverUrl)
    .post('/tasks')
    .set(authorizationHeaders)
    .send({
      executionDate,
      eventType,
      eventObjectId: assetId,
      eventMetadata: { test: true },
      metadata: { dummy: true }
    })
    .expect(200)

  t.truthy(task.id)
  t.is(task.executionDate, getRoundedDate(executionDate, { nbMinutes: 1 }))
  t.is(task.eventType, eventType)
  t.is(task.eventObjectId, assetId)
  t.is(task.eventMetadata.test, true)
  t.is(task.metadata.dummy, true)

  t.context.server._clock.tick(ms('2h'))

  await restoreClock(t)

  const { body: { results: afterEvents } } = await request(t.context.serverUrl)
    .get(`/events?type=${eventType}&objectId=${assetId}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(afterEvents.length, 1)

  afterEvents.forEach(event => t.is(event.emitterId, task.id))
})

test('creates a task with recurring parameters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['task:create:all'] })

  const { body: task } = await request(t.context.serverUrl)
    .post('/tasks')
    .set(authorizationHeaders)
    .send({
      recurringPattern: '15 * * * 2,4,5',
      eventType: 'asset_timeout',
      eventObjectId: 'ast_dmM034s1gi81giDergi8',
      eventMetadata: { test: true },
      metadata: { dummy: true }
    })
    .expect(200)

  t.truthy(task.id)
  t.is(task.recurringPattern, '15 * * * 2,4,5')
  t.is(task.recurringTimezone, null)
  t.is(task.eventType, 'asset_timeout')
  t.is(task.eventObjectId, 'ast_dmM034s1gi81giDergi8')
  t.is(task.eventMetadata.test, true)
  t.is(task.metadata.dummy, true)
})

// Must run serially because the test manipulates time
test.serial('creates a task with recurring parameters and checks events', async (t) => {
  if (!t.context.server) {
    // can happen if the server is run outside of AVA process (e.g. `npm run test:uniqueserver`)
    console.log('Warning: This test cannot be running because instance server is not accessible to manipulate time')
    t.pass()
    return
  }

  // use an api key without roles instead of access token for authentication
  // because roles checking doesn't work well with time manipulation
  // (server run indefinitely)
  const apiKey = await getApiKey({
    t,
    type: 'custom',
    permissions: [
      'task:create:all',
      'event:list:all'
    ]
  })

  // mock timing functions and restart crons so the mock can work
  t.context.server._stopCrons()
  t.context.server._initClock({
    now: new Date('2019-04-01T00:00:00.000Z'),
    toFake: ['Date', 'setTimeout'],
    shouldAdvanceTime: true
  })
  t.context.server._startCrons()

  const authorizationHeaders = {
    authorization: `Basic ${encodeBase64(apiKey.key + ':')}`
  }

  // trigger every 15 minutes between when the hour is 1, 2, 4 or 5
  const recurringPattern = '*/15 1-2,4,5 * * *'

  const eventType = 'asset_timeout'
  const assetId = 'ast_dmM034s1gi81giDergi8'

  const { body: { results: beforeEvents } } = await request(t.context.serverUrl)
    .get(`/events?type=${eventType}&objectId=${assetId}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(beforeEvents.length, 0)

  const { body: task } = await request(t.context.serverUrl)
    .post('/tasks')
    .set(authorizationHeaders)
    .send({
      recurringPattern,
      eventType,
      eventObjectId: assetId,
      eventMetadata: { test: true },
      metadata: { dummy: true }
    })
    .expect(200)

  t.truthy(task.id)
  t.is(task.recurringPattern, recurringPattern)
  t.is(task.eventType, eventType)
  t.is(task.eventObjectId, assetId)
  t.is(task.eventMetadata.test, true)
  t.is(task.metadata.dummy, true)

  // do not use a long duration, because crons function logic will trigger every simulated minute
  t.context.server._clock.tick(ms('2d'))

  await restoreClock(t, 8000)

  const { body: { results: afterEvents } } = await request(t.context.serverUrl)
    .get(`/events?type=${eventType}&objectId=${assetId}&nbResultsPerPage=100`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(afterEvents.length, 32)

  afterEvents.forEach(event => t.is(event.emitterId, task.id))
})

test('cannot provide both execution date and recurring parameters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['task:create:all'] })

  const now = new Date().toISOString()

  const { body: error } = await request(t.context.serverUrl)
    .post('/tasks')
    .set(authorizationHeaders)
    .send({
      executionDate: computeDate(now, '1d'),
      recurringPattern: '* * * * *',
      eventType: 'asset_timeout'
    })
    .expect(400)

  t.true(error.message.includes('both'))
})

test('updates a task', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['task:edit:all'] })

  const { body: task } = await request(t.context.serverUrl)
    .patch('/tasks/task_4bJEZe1bA91i7IQYbA8')
    .set(authorizationHeaders)
    .send({
      eventType: 'user_timeout',
      eventObjectId: 'usr_em9SToe1nI01iG4yRnHz',
      eventMetadata: { test: true },
      metadata: { dummy: true }
    })
    .expect(200)

  t.is(task.id, 'task_4bJEZe1bA91i7IQYbA8')
  t.is(task.eventType, 'user_timeout')
  t.is(task.eventObjectId, 'usr_em9SToe1nI01iG4yRnHz')
  t.is(task.eventMetadata.test, true)
  t.is(task.metadata.dummy, true)
})

test('cannot update a task to have both executionDate and recurring parameters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['task:edit:all'] })

  const { body: error } = await request(t.context.serverUrl)
    .patch('/tasks/task_4bJEZe1bA91i7IQYbA8')
    .set(authorizationHeaders)
    .send({
      recurringPattern: '* * * * *' // had executionDate
    })
    .expect(400)

  t.true(error.message.includes('both'))
})

test('removes a task', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'task:read:all',
      'task:create:all',
      'task:remove:all'
    ]
  })

  const { body: task } = await request(t.context.serverUrl)
    .post('/tasks')
    .set(authorizationHeaders)
    .send({
      eventType: 'random'
    })
    .expect(200)

  const { body: payload } = await request(t.context.serverUrl)
    .delete(`/tasks/${task.id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(payload.id, task.id)

  await request(t.context.serverUrl)
    .get(`/tasks/${task.id}`)
    .set(authorizationHeaders)
    .expect(404)
})

test('tasks are removed if the targeted event object is removed', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'asset:create:all',
      'asset:remove:all',
      'task:read:all',
      'task:create:all'
    ]
  })

  const now = new Date().toISOString()

  const { body: asset1 } = await request(t.context.serverUrl)
    .post('/assets')
    .set(authorizationHeaders)
    .send({
      name: 'Asset to remove'
    })
    .expect(200)

  const { body: asset2 } = await request(t.context.serverUrl)
    .post('/assets')
    .set(authorizationHeaders)
    .send({
      name: 'Asset will not be removed'
    })
    .expect(200)

  const executionDate = computeDate(now, '1d')

  const { body: task1 } = await request(t.context.serverUrl)
    .post('/tasks')
    .set(authorizationHeaders)
    .send({
      executionDate,
      eventType: 'asset_timeout',
      eventObjectId: asset1.id,
      eventMetadata: { test: true },
      metadata: { dummy: true }
    })
    .expect(200)

  const { body: task2 } = await request(t.context.serverUrl)
    .post('/tasks')
    .set(authorizationHeaders)
    .send({
      recurringPattern: '15 * * * 2,4,5',
      eventType: 'asset_timeout',
      eventObjectId: asset1.id,
      eventMetadata: { test: true },
      metadata: { dummy: true }
    })
    .expect(200)

  const { body: task3 } = await request(t.context.serverUrl)
    .post('/tasks')
    .set(authorizationHeaders)
    .send({
      recurringPattern: '15 * * * 2,4,5',
      eventType: 'asset_timeout',
      eventObjectId: asset2.id,
      eventMetadata: { test: true },
      metadata: { dummy: true }
    })
    .expect(200)

  await request(t.context.serverUrl)
    .delete(`/assets/${asset1.id}`)
    .set(authorizationHeaders)
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 1000))

  await request(t.context.serverUrl)
    .get(`/tasks/${task1.id}`)
    .set(authorizationHeaders)
    .expect(404)

  await request(t.context.serverUrl)
    .get(`/tasks/${task2.id}`)
    .set(authorizationHeaders)
    .expect(404)

  const { body: foundTask3 } = await request(t.context.serverUrl)
    .get(`/tasks/${task3.id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(task3.id, foundTask3.id)
})

// ////////// //
// VALIDATION //
// ////////// //

test('fails to create a task if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .post('/tasks')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // missing required parameters
  result = await request(t.context.serverUrl)
    .post('/tasks')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({})
    .expect(400)

  error = result.body
  t.true(error.message.includes('"eventType" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .post('/tasks')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      executionDate: true,
      recurringPattern: true,
      recurringTimezone: true,
      eventType: true,
      eventMetadata: true,
      eventObjectId: true,
      active: 'invalid',
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"executionDate" must be a string'))
  t.true(error.message.includes('"recurringPattern" must be a string'))
  t.true(error.message.includes('"recurringTimezone" must be a string'))
  t.true(error.message.includes('"eventType" must be a string'))
  t.true(error.message.includes('"eventMetadata" must be of type object'))
  t.true(error.message.includes('"eventObjectId" must be a string'))
  t.true(error.message.includes('"active" must be a boolean'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

test('fails to update a task if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .patch('/tasks/task_4bJEZe1bA91i7IQYbA8')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .patch('/tasks/task_4bJEZe1bA91i7IQYbA8')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      executionDate: true,
      recurringPattern: true,
      recurringTimezone: true,
      eventType: true,
      eventMetadata: true,
      eventObjectId: true,
      active: 'invalid',
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"executionDate" must be a string'))
  t.true(error.message.includes('"recurringPattern" must be a string'))
  t.true(error.message.includes('"recurringTimezone" must be a string'))
  t.true(error.message.includes('"eventType" must be a string'))
  t.true(error.message.includes('"eventMetadata" must be of type object'))
  t.true(error.message.includes('"eventObjectId" must be a string'))
  t.true(error.message.includes('"active" must be a boolean'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

// //////// //
// VERSIONS //
// //////// //

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('2019-05-20: list tasks with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['task:list:all']
  })

  await checkOffsetPaginationScenario({
    t,
    endpointUrl: '/tasks',
    authorizationHeaders,
    checkResultsFn: (t, task) => {
      t.truthy(task.id)
      t.true(_.isString(task.eventType))
    }
  })
})

test('2019-05-20: list tasks with id filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['task:list:all']
  })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/tasks?id=task_4bJEZe1bA91i7IQYbA8')
    .set(authorizationHeaders)
    .expect(200)

  checkOffsetPaginatedListObject(t, obj)
  t.is(obj.nbResults, 1)
})
