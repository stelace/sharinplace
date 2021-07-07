require('dotenv').config()

const test = require('ava')
const request = require('supertest')
const _ = require('lodash')
const express = require('express')
const bodyParser = require('body-parser')

const userServer = express()
const userServerCalls = {}
const userServerCallsHeaders = {}
let userApp

const { before, beforeEach, after } = require('../../lifecycle')
const { getAccessTokenHeaders, getSystemKey } = require('../../auth')

const {
  computeDate,

  checkCursorPaginationScenario,
  checkCursorPaginatedListObject,
  checkCursorPaginatedHistoryObject,

  checkFilters,
} = require('../../util')

const { truncateDate } = require('../../../src/util/time')

function getAuthorizationHeaders ({ t, systemKey }) {
  const headers = {
    'x-stelace-system-key': systemKey,
    'x-platform-id': t.context.platformId,
    'x-stelace-env': t.context.env,
  }
  return headers
}

/* eslint-disable no-template-curly-in-string */

const defaultTestDelay = 4000

let createdWorkflows

async function createWorkflowLogs (t) {
  if (createdWorkflows) return createdWorkflows

  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'workflowLog:list:all',
      'workflow:create:all',
      'category:create:all',
      'entry:create:all',
      'message:create:all',
    ]
  })

  // should create workflows that listen to events that are not triggered by any tests below

  const { body: categoryWorkflow } = await request(t.context.serverUrl)
    .post('/workflows')
    .set(authorizationHeaders)
    .send({
      name: 'Workflow for category creation',
      event: 'category__created',
      run: { // single-step object allowed
        endpointMethod: 'PATCH',
        endpointUri: '/categories/${object.id}',
        endpointPayload: JSON.stringify({ // simulate real API call (string JSON only)
          metadata: {
            updated: true
          }
        })
      }
    })
    .expect(200)

  const { body: messageWorkflow } = await request(t.context.serverUrl)
    .post('/workflows')
    .set(authorizationHeaders)
    .send({
      name: 'Workflow for message creation',
      event: 'message__created',
      run: { // single-step object allowed
        endpointMethod: 'PATCH',
        endpointUri: '/messages/${object.id}',
        endpointPayload: JSON.stringify({ // simulate real API call (string JSON only)
          metadata: {
            updated: true
          }
        })
      }
    })
    .expect(200)

  const { body: entryWorkflow } = await request(t.context.serverUrl)
    .post('/workflows')
    .set(authorizationHeaders)
    .send({
      name: 'Workflow for entry creation',
      event: 'entry__created',
      run: { // single-step object allowed
        endpointMethod: 'PATCH',
        endpointUri: '/entries/${object.id}',
        endpointPayload: JSON.stringify({ // simulate real API call (string JSON only)
          metadata: {
            updated: true
          }
        })
      }
    })
    .expect(200)

  createdWorkflows = _.keyBy([
    categoryWorkflow,
    messageWorkflow,
    entryWorkflow,
  ], 'event')

  await request(t.context.serverUrl)
    .post('/categories')
    .set(authorizationHeaders)
    .send({
      name: 'Some category',
    })
    .expect(200)

  await request(t.context.serverUrl)
    .post('/messages')
    .set(authorizationHeaders)
    .send({
      topicId: 'ast_2l7fQps1I3a1gJYz2I3a',
      receiverId: 'user-external-id',
      content: 'Good',
    })
    .expect(200)

  await request(t.context.serverUrl)
    .post('/entries')
    .set(authorizationHeaders)
    .send({
      collection: 'someCollection',
      locale: 'en-US',
      name: 'nameExample',
      fields: {
        title: 'Random title',
        content: 'Random content',
        nestedContent: {
          random1: {
            random2: 'hello'
          },
          random3: 'bye'
        }
      }
    })
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, defaultTestDelay))
}

test.before(async (t) => {
  await before({ name: 'workflow' })(t)
  await beforeEach()(t)

  userServer.use(bodyParser.json())
  userServer.all('*', function (req, res, next) {
    req._workflowName = req.path.replace('/', '')
    req._stopped = _.get(req.body, 'lastStep.stopped') // falsy `filter` or truthy `stop` in some step

    if (!Array.isArray(userServerCallsHeaders[req._workflowName])) {
      userServerCallsHeaders[req._workflowName] = []
    }
    userServerCallsHeaders[req._workflowName].unshift(req.headers)
    next()
  })
  userServer.post('/error', function (req, res) {
    res.status(500).json({ message: 'Webhook target server error' })
  })
  userServer.post('*', function (req, res) {
    // Filtered workflows logs could also be stored separately
    if (req._stopped) return res.json({ ok: true })

    if (!Array.isArray(userServerCalls[req._workflowName])) {
      userServerCalls[req._workflowName] = []
    }
    userServerCalls[req._workflowName].unshift(req.body)
    res.json({ ok: true })
  })

  await new Promise((resolve, reject) => {
    userApp = userServer.listen((err) => {
      if (err) return reject(err)

      resolve()
    })
  })

  await createWorkflowLogs(t)
})
// test.beforeEach(beforeEach()) // tests are run concurrently
test.after(async (t) => {
  await after()(t)
  await userApp.close()
})

// run this test serially because there is no filter and some other tests create workflow logs
// that can turn the check on `count` property incorrect
test.serial('get workflow logs history with pagination', async (t) => {
  const authorizationHeaders = getAuthorizationHeaders({ t, systemKey: getSystemKey() })

  const groupByValues = ['hour', 'day', 'month']

  for (const groupBy of groupByValues) {
    await checkCursorPaginationScenario({
      t,
      endpointUrl: `/workflow-logs/history?groupBy=${groupBy}`,
      authorizationHeaders,
      orderBy: groupBy,
      passOrderByToQuery: false,
      nbResultsPerPage: 1, // not many workflow logs with different dates, so let's create page of 1 result
    })
  }
})

// run this test serially because there is no filter and some other tests create workflow logs
// that can turn the check on `count` property incorrect
test.serial('get workflow logs history', async (t) => {
  const authorizationHeaders = getAuthorizationHeaders({ t, systemKey: getSystemKey() })

  const { body: { results: workflowLogs } } = await request(t.context.serverUrl)
    .get('/workflow-logs')
    .set(authorizationHeaders)
    .expect(200)

  const groupByValues = ['hour', 'day', 'month']

  for (const groupBy of groupByValues) {
    const { body: dayObj } = await request(t.context.serverUrl)
      .get(`/workflow-logs/history?groupBy=${groupBy}`)
      .set(authorizationHeaders)
      .expect(200)

    checkCursorPaginatedHistoryObject({
      t,
      obj: dayObj,
      groupBy,
      results: workflowLogs
    })
  }
})

test('get workflow logs history with filters', async (t) => {
  const authorizationHeaders = getAuthorizationHeaders({ t, systemKey: getSystemKey() })

  const filters = 'type=action'

  const { body: { results: workflowLogs } } = await request(t.context.serverUrl)
    .get(`/workflow-logs?${filters}`)
    .set(authorizationHeaders)
    .expect(200)

  const groupBy = 'day'

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/workflow-logs/history?groupBy=${groupBy}&${filters}`)
    .set(authorizationHeaders)
    .expect(200)

  checkCursorPaginatedHistoryObject({
    t,
    obj,
    groupBy,
    results: workflowLogs
  })
})

test('get workflow logs history with date filter', async (t) => {
  const authorizationHeaders = getAuthorizationHeaders({ t, systemKey: getSystemKey() })

  const now = new Date().toISOString()

  const minCreatedDate = computeDate(now, '-10d')
  const filters = `type=action&createdDate[gte]=${minCreatedDate}`

  const { body: { results: workflowLogs } } = await request(t.context.serverUrl)
    .get(`/workflow-logs?${filters}`)
    .set(authorizationHeaders)
    .expect(200)

  const groupBy = 'day'

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/workflow-logs/history?groupBy=${groupBy}&${filters}`)
    .set(authorizationHeaders)
    .expect(200)

  checkCursorPaginatedHistoryObject({
    t,
    obj,
    groupBy,
    results: workflowLogs
  })
})

test('fails to get workflow logs history with redundant relational operators', async (t) => {
  const authorizationHeaders = getAuthorizationHeaders({ t, systemKey: getSystemKey() })

  const now = new Date().toISOString()
  const date = computeDate(now, '-10d')

  const { body: error1 } = await request(t.context.serverUrl)
    .get(`/workflow-logs/history?groupBy=day&createdDate[gt]=${date}&createdDate[gte]=${date}`)
    .set(authorizationHeaders)
    .expect(400)

  t.true(error1.message.includes('optional exclusive peers'))

  const { body: error2 } = await request(t.context.serverUrl)
    .get(`/workflow-logs/history?groupBy=day&createdDate[lt]=${date}&createdDate[lte]=${date}`)
    .set(authorizationHeaders)
    .expect(400)

  t.true(error2.message.includes('optional exclusive peers'))
})

// run this test serially because there is no filter and some other tests create workflow logs
// that can turn the check on `count` property incorrect
test.serial('can apply filters only with created date within the retention log period', async (t) => {
  const authorizationHeaders = getAuthorizationHeaders({ t, systemKey: getSystemKey() })

  const now = new Date().toISOString()

  const oldCreatedDate = computeDate(now, '-1y')
  const filters = `eventId=evt_Qtup0Ae1BJI1k6MK0BJI&type=action&createdDate[gte]=${oldCreatedDate}`

  const groupBy = 'day'

  await request(t.context.serverUrl)
    .get(`/workflow-logs/history?groupBy=${groupBy}&${filters}`)
    .set(authorizationHeaders)
    .expect(400)

  const minCreatedDate = computeDate(now, '-10d')

  const { body: { results: workflowLogs } } = await request(t.context.serverUrl)
    .get(`/workflow-logs?createdDate[gte]=${minCreatedDate}`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/workflow-logs/history?groupBy=${groupBy}&createdDate[gte]=${minCreatedDate}`)
    .set(authorizationHeaders)
    .expect(200)

  checkCursorPaginatedHistoryObject({
    t,
    obj,
    groupBy,
    results: workflowLogs
  })
})

test('can apply type filter beyond the retention log period', async (t) => {
  const authorizationHeaders = getAuthorizationHeaders({ t, systemKey: getSystemKey() })

  const now = new Date().toISOString()
  const oldCreatedDate = computeDate(now, '-1y')

  const groupBy = 'day'

  const filtersWithType = `createdDate[gte]=${oldCreatedDate}&type[]=action&type[]=stopped`

  const { body: objWithType } = await request(t.context.serverUrl)
    .get(`/workflow-logs/history?groupBy=${groupBy}&${filtersWithType}`)
    .set(authorizationHeaders)
    .expect(200)

  // cannot check with `checkCursorPaginatedHistoryObject()` utility function
  // because individual workflow logs cannot be retrieved if the date filter is beyond the retention log period
  const checkResultsFn = (t, result) => {
    t.true(typeof result === 'object')
    t.true(typeof result[groupBy] === 'string')
    t.true(typeof result.count === 'number')
  }

  checkCursorPaginatedListObject(t, objWithType, { checkResultsFn })
})

// use serial because no changes must be made during the check
test.serial('check history filters', async (t) => {
  const authorizationHeaders = getAuthorizationHeaders({ t, systemKey: getSystemKey() })

  const { body: { results } } = await request(t.context.serverUrl)
    .get('/workflow-logs?nbResultsPerPage=100')
    .set(authorizationHeaders)
    .expect(200)

  const groupBy = 'day'

  const customExactValueCheck = _.curry((prop, obj, value) => {
    let filteredResults = results.filter(r => truncateDate(r.createdDate) === obj[groupBy])
    filteredResults = filteredResults.filter(r => r[prop] === value)
    return filteredResults.length === obj.count
  })

  const customArrayValuesCheck = _.curry((prop, obj, values) => {
    let filteredResults = results.filter(r => truncateDate(r.createdDate) === obj[groupBy])
    filteredResults = filteredResults.filter(r => values.includes(r[prop]))
    return filteredResults.length === obj.count
  })

  const customRangeValuesCheck = _.curry((prop, obj, rangeValues) => {
    let filteredResults = results.filter(r => truncateDate(r.createdDate) === obj[groupBy])
    filteredResults = filteredResults.filter(r => rangeValues.gte <= r[prop] && r[prop] <= rangeValues.lte)
    return filteredResults.length === obj.count
  })

  await checkFilters({
    t,
    endpointUrl: `/workflow-logs/history?groupBy=${groupBy}`,
    fetchEndpointUrl: '/workflow-logs',
    authorizationHeaders,
    checkPaginationObject: checkCursorPaginatedListObject,

    filters: [
      {
        prop: 'id',
        customExactValueFilterCheck: customExactValueCheck('id'),
        customArrayFilterCheck: customArrayValuesCheck('id'),
      },
      {
        prop: 'createdDate',
        customExactValueFilterCheck: customExactValueCheck('createdDate'),
        customArrayFilterCheck: customRangeValuesCheck('createdDate'),

        // the function will check a single value range, which will return no results
        // triggering an error if this boolean isn't true
        noResultsExistenceCheck: true,
      },
      {
        prop: 'workflowId',
        customExactValueFilterCheck: customExactValueCheck('workflowId'),
        customArrayFilterCheck: customArrayValuesCheck('workflowId'),
      },
      {
        prop: 'eventId',
        customExactValueFilterCheck: customExactValueCheck('eventId'),
        customArrayFilterCheck: customArrayValuesCheck('eventId'),
      },
      {
        prop: 'runId',
        customExactValueFilterCheck: customExactValueCheck('runId'),
        customArrayFilterCheck: customArrayValuesCheck('runId'),
      },
      {
        prop: 'type',
        customExactValueFilterCheck: customExactValueCheck('type'),
        customArrayFilterCheck: customArrayValuesCheck('type'),
      },
    ],
  })
})

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('list workflow logs', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['workflowLog:list:all'] })

  await checkCursorPaginationScenario({
    t,
    endpointUrl: '/workflow-logs',
    authorizationHeaders,
  })
})

test('list workflow logs with advanced filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['workflowLog:list:all'] })

  const now = new Date().toISOString()
  const minDate = computeDate(now, '-10d')

  const {
    category__created: categoryWorkflow,
    message__created: messageWorkflow,
  } = createdWorkflows

  const params = `createdDate[gte]=${encodeURIComponent(minDate)}` +
    `&workflowId[]=${categoryWorkflow.id}` +
    `&workflowId[]=${messageWorkflow.id}`

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/workflow-logs?${params}`)
    .set(authorizationHeaders)
    .expect(200)

  const checkResultsFn = (t, workflowLog) => {
    t.true(workflowLog.createdDate >= minDate)
    t.true([categoryWorkflow.id, messageWorkflow.id].includes(workflowLog.workflowId))
  }

  checkCursorPaginatedListObject(t, obj, { checkResultsFn })
})

// use serial because no changes must be made during the check
test.serial('check list filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['workflowLog:list:all'] })

  await checkFilters({
    t,
    endpointUrl: '/workflow-logs',
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
        prop: 'workflowId',
        isArrayFilter: true,
      },
      {
        prop: 'eventId',
        isArrayFilter: true,
      },
      {
        prop: 'runId',
        isArrayFilter: true,
      },
      {
        prop: 'type',
        customTestValues: ['action', 'skipped', 'stopped', 'runError', 'preRunError', 'notification']
      },
    ],
  })
})

test('finds a workflow log', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'workflowLog:list:all',
      'workflowLog:read:all'
    ]
  })

  const { body: { results: workflowLogs } } = await request(t.context.serverUrl)
    .get('/workflow-logs')
    .set(authorizationHeaders)
    .expect(200)

  const { body: workflowLog } = await request(t.context.serverUrl)
    .get(`/workflow-logs/${workflowLogs[0].id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(workflowLog.id, workflowLogs[0].id)
})
