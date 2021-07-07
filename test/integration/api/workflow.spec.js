require('dotenv').config()

const test = require('ava')
const request = require('supertest')
const _ = require('lodash')
const express = require('express')
const bodyParser = require('body-parser')

const userServer = express()
let userServerPort
const userServerCalls = {}
const userServerCallsHeaders = {}
let userApp

const { apiVersions } = require('../../../src/versions')
const { before, beforeEach, after } = require('../../lifecycle')
const { getAccessTokenHeaders } = require('../../auth')
const {
  getObjectEvent,
  testEventMetadata,

  checkCursorPaginationScenario,
  checkCursorPaginatedListObject,

  checkFilters,
} = require('../../util')

const { encodeBase64 } = require('../../../src/util/encoding')

const getIds = (elements) => elements.map(e => e.id)
const areSameIds = (ids1, ids2) => _.difference(ids1, ids2).length === 0

let userWebhookUrl
/* eslint-disable no-template-curly-in-string */

const defaultTestDelay = 8000

const isErrorLog = log => ['preRunError', 'runError'].includes(log.type)
const isActionLog = log => log.type === 'action'
const isSkippedLog = log => log.type === 'skipped'
const isStoppedLog = log => log.type === 'stopped'
const isNotificationLog = log => log.type === 'notification'

test.before(async (t) => {
  await before({ name: 'workflow' })(t)
  await beforeEach()(t)

  userServer.use(bodyParser.json())
  userServer.all('*', function (req, res, next) {
    req._workflowName = req.path.replace('/', '')
    req._stopped = req.body.type === 'stopped'

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

      // dynamically get a free port
      userServerPort = userApp.address().port

      userWebhookUrl = `http://localhost:${userServerPort}/`

      resolve()
    })
  })
})
// test.beforeEach(beforeEach()) // tests are run concurrently
test.after(async (t) => {
  await after()(t)
  await userApp.close()
})

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('list workflows', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['workflow:list:all'] })

  await checkCursorPaginationScenario({
    t,
    endpointUrl: '/workflows',
    authorizationHeaders,
  })
})

test('list workflows with id filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['workflow:list:all'] })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/workflows?id=wfw_SEIfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  checkCursorPaginatedListObject(t, obj)
  t.is(obj.results.length, 1)
})

test('list workflows with advanced filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['workflow:list:all'] })

  const minDate = '2019-01-01T00:00:00.000Z'

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/workflows?createdDate[gte]=${encodeURIComponent(minDate)}&active=true`)
    .set(authorizationHeaders)
    .expect(200)

  const checkResultsFn = (t, workflow) => {
    t.true(workflow.active)
    t.true(workflow.createdDate >= minDate)
  }

  checkCursorPaginatedListObject(t, obj, { checkResultsFn })
})

// use serial because no changes must be made during the check
test.serial('check list filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['workflow:list:all'] })

  await checkFilters({
    t,
    endpointUrl: '/workflows',
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
        prop: 'event',
        isArrayFilter: true,
      },
      {
        prop: 'active',
        customTestValues: [true, false],
      },
    ],
  })
})

test('list workflows with custom namespace', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['workflow:list:all'],
    readNamespaces: ['custom']
  })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/workflows')
    .set(authorizationHeaders)
    .expect(200)

  checkCursorPaginatedListObject(t, obj)

  const workflows = obj.results

  const hasAtLeastOneCustomNamespace = workflows.some(w => typeof w.platformData._custom !== 'undefined')
  t.true(hasAtLeastOneCustomNamespace)
})

test('finds a workflow', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['workflow:read:all'] })

  const { body: workflow } = await request(t.context.serverUrl)
    .get('/workflows/wfw_SEIfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  t.is(workflow.id, 'wfw_SEIfQps1I3a1gJYz2I3a')
  t.is(workflow.name, 'Test workflow')
})

test('creates and updates a workflow', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'workflow:create:all',
      'workflow:edit:all'
    ]
  })

  const { body: workflow } = await request(t.context.serverUrl)
    .post('/workflows')
    .set(authorizationHeaders)
    .send({
      name: 'Custom workflow',
      description: 'Having a "description"',
      context: 'test',
      notifyUrl: 'https://example.com',
      event: 'custom'
    })
    .expect(200)

  t.is(workflow.name, 'Custom workflow')
  t.is(workflow.description, 'Having a "description"')
  t.deepEqual(workflow.context, ['test'])
  t.is(workflow.notifyUrl, 'https://example.com')
  t.is(workflow.apiVersion, apiVersions[0])
  t.is(workflow.event, 'custom')

  const { body: workflowUpdated } = await request(t.context.serverUrl)
    .patch(`/workflows/${workflow.id}`)
    .set(authorizationHeaders)
    .send({
      name: 'Updated workflow',
      description: '',
      context: ['test', 'override'],
      notifyUrl: 'https://other.com',
      apiVersion: '2019-05-20',
      event: 'other'
    })
    .expect(200)

  t.is(workflowUpdated.name, 'Updated workflow')
  t.is(workflowUpdated.description, '')
  t.deepEqual(workflowUpdated.context, ['test', 'override'])
  t.is(workflowUpdated.notifyUrl, 'https://other.com')
  t.is(workflowUpdated.event, 'other')
  t.is(workflowUpdated.apiVersion, '2019-05-20')
})

test('creates several single-step Stelace workflows', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'workflow:create:all',
      'workflow:read:all',
      'workflowLog:list:all',
    ]
  })
  const workflowName = 'Single-step Workflow'
  const workflow1NotifyUrl = userWebhookUrl + 'workflow1'

  const currentTestProp = 'singleStepWorkflow'

  const { body: workflow1 } = await request(t.context.serverUrl)
    .post('/workflows')
    .set(authorizationHeaders)
    .send({
      name: workflowName,
      notifyUrl: workflow1NotifyUrl,
      event: 'asset__updated',
      context: 'test',
      run: { // single-step object allowed
        endpointMethod: 'POST',
        computed: { // set new variables in vm for powerful combos in "action"
          futurePrice: '_.get(asset, "doesNotExist", 23) + 1',
          assetId: 'asset.id', // shorter syntax
          startDate: 'new Date().toISOString()',
          endDate: 'new Date(new Date().getTime() + (14 * 24 * 60 * 60 * 1000)).toISOString()',
          isCurrentTest: `_.get(changesRequested, "metadata.${currentTestProp}")`,

          // localized date in Chinese format
          localizedDate: `
            new Intl.DateTimeFormat('zh-CN', {
              day: 'numeric',
              month : 'long',
              year : 'numeric'
            }).format(new Date('2019-02-05'))
          `,
          nestedObjects: [
            {
              nested: true
            }
          ]
        },
        filter: 'asset.price >= 200 && computed.isCurrentTest',
        stop: 'false', // default
        skip: 'false', // default
        endpointUri: '/availabilities',
        endpointPayload: JSON.stringify({ // simulate real API call (string JSON only)
          assetId: 'computed.assetId',
          startDate: 'new Date().toISOString()', // same as computed.startDate
          endDate: 'computed.endDate',
          quantity: 1,
          metadata: {
            futurePrice: 'computed.futurePrice',
            var: 'env.TEST_ENV_VARIABLE',
            otherVar: 'env.OTHER_ENV_VARIABLE', // should be undefined (cf. config fixtures)
            nestedObjects: 'computed.nestedObjects',
            localizedDate: 'computed.localizedDate'
          },
          platformData: {
            platformDataField: '"test"'
          }
        })
      }
    })
    .expect(200)

  t.is(workflow1.name, workflowName)
  t.is(typeof workflow1.run[0].endpointPayload, 'object')
  t.true(Array.isArray(workflow1.run[0].computed.nestedObjects))
  t.is(userServerCalls.workflow1, undefined)

  const assetId = 'ast_dmM034s1gi81giDergi8'
  const availabilityAuthorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['availability:list:all']
  })

  const {
    body:
    { results: asset1AvailabilitiesBeforeWorkflow1 }
  } = await request(t.context.serverUrl)
    .get(`/availabilities?assetId=${assetId}`)
    .set(availabilityAuthorizationHeaders)
    .expect(200)

  // Trigger workflow #1

  await request(t.context.serverUrl)
    .patch(`/assets/${assetId}`)
    .set({
      authorization: `Basic ${encodeBase64('seck_live_iuJzTKo5wumuE1imSjmcgimR:')}`,
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: 'Asset triggering Stelace Workflow',
      metadata: { [currentTestProp]: true }
    })
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, defaultTestDelay))

  t.is(userServerCalls.workflow1.length, 1)

  const { body: workflow1AfterRun1 } = await request(t.context.serverUrl)
    .get(`/workflows/${workflow1.id}?logs=`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: { results: workflowLogsAfterRun1 } } = await request(t.context.serverUrl)
    .get(`/workflow-logs?workflowId=${workflow1.id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(areSameIds(getIds(workflow1AfterRun1.logs), getIds(workflowLogsAfterRun1)))

  const workflow1AfterRun1ErrorLogs = workflow1AfterRun1.logs.filter(isErrorLog)
  const workflow1AfterRun1Actions = workflow1AfterRun1.logs.filter(isActionLog)

  t.is(workflow1AfterRun1ErrorLogs.length, 0)
  t.is(workflow1AfterRun1Actions.length, 1)
  const workflow1LogsCall1 = workflow1AfterRun1Actions[0]
  t.is(workflow1LogsCall1.metadata.eventObjectId, assetId)
  t.is(workflow1LogsCall1.metadata.endpointMethod, 'POST')
  t.is(workflow1LogsCall1.metadata.endpointUri, '/availabilities')
  t.is(workflow1LogsCall1.metadata.endpointPayload.quantity, 1)
  t.is(workflow1LogsCall1.metadata.endpointPayload.metadata.futurePrice, 24)
  t.is(workflow1LogsCall1.metadata.endpointPayload.metadata.var, 'true')
  t.deepEqual(workflow1LogsCall1.metadata.endpointPayload.metadata.nestedObjects, [{ nested: true }])
  t.is(workflow1LogsCall1.metadata.endpointPayload.metadata.localizedDate, '2019年2月5日')
  t.is(typeof workflow1LogsCall1.metadata.endpointPayload.metadata.otherVar, 'undefined')
  t.is(workflow1AfterRun1.stats.nbActionsCompleted, 1)
  t.is(workflow1AfterRun1.stats.nbTimesRun, workflow1AfterRun1.stats.nbWorkflowNotifications)
  // Workflow events from concurrent tests can trigger this workflow
  t.true(workflow1AfterRun1.stats.nbTimesRun >= 1)

  const {
    body:
    { results: asset1AvailabilitiesAfterWorkflow1 }
  } = await request(t.context.serverUrl)
    .get(`/availabilities?assetId=${assetId}`)
    .set(availabilityAuthorizationHeaders)
    .expect(200)

  t.is(asset1AvailabilitiesAfterWorkflow1.length, asset1AvailabilitiesBeforeWorkflow1.length + 1)
  t.falsy(asset1AvailabilitiesBeforeWorkflow1.find((availability) => {
    return availability.metadata.futurePrice === 24
  }))
  const workflowAvailability = asset1AvailabilitiesAfterWorkflow1.find((availability) => {
    return availability.metadata.futurePrice === 24
  })
  t.truthy(workflowAvailability)
  t.is(workflowAvailability.platformData.platformDataField, 'test')
  t.deepEqual(workflowAvailability.metadata.nestedObjects, [{ nested: true }])

  // Test multiple workflows and sandbox reuse

  const now = new Date().toISOString()
  const date2 = new Date(new Date(now).getTime() + (14 * 24 * 60 * 60 * 1000)).toISOString()
  const workflow2NotifyUrl = userWebhookUrl + 'workflow2'

  await request(t.context.serverUrl)
    .post('/workflows')
    .set(authorizationHeaders)
    .send({
      name: ` ${workflowName} 2`,
      notifyUrl: workflow2NotifyUrl,
      event: 'asset__updated',
      context: ['other'],
      computed: { // Test root computed object
        assetTypeId: 'assetType.id',
        someString: "'wrapped in simple quotes'",
        startDate: `'${now}'`,
        endDate: `new Date(new Date('${now}').getTime() + (14 * 24 * 60 * 60 * 1000)).toISOString()`,
        isCurrentTest: `_.get(changesRequested, "metadata.${currentTestProp}")`
      },
      run: {
        filter: 'computed.isCurrentTest',
        endpointMethod: 'PATCH',
        // Template string allowed in endpointUri and endpointHeaders
        // to inject any objectId directly or through computed
        endpointUri: '/asset-types/${computed.assetTypeId}',
        endpointPayload: {
          metadata: {
            date1: 'computed.startDate',
            date2: 'computed.endDate',
            someString: 'computed.someString',
            otherString: "'works too'", // simpler than using computed if JS evaluation is not needed
            assetId: 'computed.assetId', // should be undefined, reset after Workflow #1
            lastResponsesWrongRef: 'lastResponses.id', // should be undefined
            var: 'env.TEST_ENV_VARIABLE', // should be undefined
            otherVar: 'env.OTHER_ENV_VARIABLE'
          }
        }
      }
    })
    .expect(200)

  t.is(userServerCalls.workflow1.length, 1)
  t.is(userServerCalls.workflow2, undefined)

  const asset2Id = 'ast_2l7fQps1I3a1gJYz2I3a'
  const assetAuthorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['asset:read:all']
  })
  const assetTypeAuthorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['assetType:read:all']
  })

  const { body: { assetTypeId } } = await request(t.context.serverUrl)
    .get(`/assets/${asset2Id}`)
    .set(assetAuthorizationHeaders)
    .expect(200)

  const { body: assetTypeBeforeWorkflow } = await request(t.context.serverUrl)
    .get(`/asset-types/${assetTypeId}`)
    .set(assetTypeAuthorizationHeaders)
    .expect(200)

  const {
    body:
    { results: asset2AvailabilitiesBeforeWorkflow2 }
  } = await request(t.context.serverUrl)
    .get(`/availabilities?assetId=${asset2Id}`)
    .set(availabilityAuthorizationHeaders)
    .expect(200)

  // Trigger two Stelace Workflows

  await request(t.context.serverUrl)
    .patch(`/assets/${asset2Id}`)
    .set({
      authorization: `Basic ${encodeBase64('seck_live_iuJzTKo5wumuE1imSjmcgimR:')}`,
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: 'Asset triggering Stelace Workflow 2',
      metadata: { [currentTestProp]: true }
    })
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, defaultTestDelay))

  // Following asset__updated event
  t.is(userServerCalls.workflow1.length, 2) // Second call of first Workflow
  t.is(userServerCalls.workflow2.length, 1) // First call of second Workflow

  const { body: workflow1AfterRun2 } = await request(t.context.serverUrl)
    .get(`/workflows/${workflow1.id}?logs=`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: { results: workflowLogsAfterRun2 } } = await request(t.context.serverUrl)
    .get(`/workflow-logs?workflowId=${workflow1.id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(areSameIds(getIds(workflow1AfterRun2.logs), getIds(workflowLogsAfterRun2)))

  const workflow1AfterRun2ErrorLogs = workflow1AfterRun2.logs.filter(isErrorLog)
  let workflowAfterRun2Notifications = workflow1AfterRun2.logs.filter(isNotificationLog)
  const workflow1AfterRun2Actions = workflow1AfterRun2.logs.filter(isActionLog)

  // filter on notifications logs that were created by this test
  workflowAfterRun2Notifications = workflowAfterRun2Notifications.filter(l => {
    return _.get(l, `metadata.notifyPayload.event.changesRequested.metadata.${currentTestProp}`) === true
  })

  t.is(workflow1AfterRun2ErrorLogs.length, 0)
  t.is(workflow1AfterRun2Actions.length, 2)

  const workflow1LogsCall2 = workflow1AfterRun2Actions[0] // most recent first
  t.is(workflow1LogsCall2.metadata.eventObjectId, asset2Id)
  t.is(workflow1LogsCall2.metadata.endpointMethod, 'POST')
  t.is(workflow1LogsCall2.metadata.endpointUri, '/availabilities')
  t.is(workflow1LogsCall2.metadata.endpointPayload.quantity, 1)
  t.is(workflow1LogsCall2.metadata.endpointPayload.metadata.futurePrice, 24)
  t.is(workflow1LogsCall2.metadata.endpointPayload.metadata.var, 'true')
  t.is(typeof workflow1LogsCall2.metadata.endpointPayload.metadata.otherVar, 'undefined')

  t.is(workflowAfterRun2Notifications[0].metadata.notifyPayload.type, 'action')
  t.true(workflowAfterRun2Notifications.some(log => log.metadata.notifyUrl === workflow1NotifyUrl))

  t.is(workflow1AfterRun2.stats.nbActionsCompleted, 2)
  t.is(workflow1AfterRun2.stats.nbTimesRun, workflow1AfterRun2.stats.nbWorkflowNotifications)
  // Workflow events from concurrent tests can trigger this workflow
  t.true(workflow1AfterRun2.stats.nbTimesRun >= 2)

  const { body: assetTypeAfterWorkflow } = await request(t.context.serverUrl)
    .get(`/asset-types/${assetTypeId}`)
    .set(assetTypeAuthorizationHeaders)
    .expect(200)

  const {
    body:
    { results: asset1AvailabilitiesAfterWorkflow2 }
  } = await request(t.context.serverUrl)
    .get(`/availabilities?assetId=${assetId}`)
    .set(availabilityAuthorizationHeaders)
    .expect(200)

  const {
    body:
    { results: asset2AvailabilitiesAfterWorkflow2 }
  } = await request(t.context.serverUrl)
    .get(`/availabilities?assetId=${asset2Id}`)
    .set(availabilityAuthorizationHeaders)
    .expect(200)

  // No change for asset 1
  t.is(asset1AvailabilitiesAfterWorkflow2.length, asset1AvailabilitiesAfterWorkflow1.length)
  // New availability for patched asset 2
  t.is(asset2AvailabilitiesAfterWorkflow2.length, asset2AvailabilitiesBeforeWorkflow2.length + 1)

  // Stelace Workflow #2
  t.is(assetTypeBeforeWorkflow.metadata.date1, undefined)
  t.is(assetTypeBeforeWorkflow.metadata.date2, undefined)
  t.is(assetTypeAfterWorkflow.metadata.date1, now)
  t.is(assetTypeAfterWorkflow.metadata.date2, date2)
  t.is(assetTypeAfterWorkflow.metadata.someString, 'wrapped in simple quotes')
  t.is(assetTypeAfterWorkflow.metadata.otherString, 'works too')
  t.is(assetTypeAfterWorkflow.metadata.assetId, undefined)
  t.is(assetTypeAfterWorkflow.metadata.lastResponsesWrongRef, undefined)
  t.is(typeof assetTypeAfterWorkflow.metadata.var, 'undefined')
  t.is(assetTypeAfterWorkflow.metadata.otherVar, 'test')

  // Test event generated after Workflow #2

  const eventAuthorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['event:list:all'] })
  const { body: { results: events } } = await request(t.context.serverUrl)
    .get('/events')
    .set(eventAuthorizationHeaders)
    .expect(200)

  const assetTypeUpdatedEvent = getObjectEvent({
    events,
    eventType: 'asset_type__updated',
    objectId: assetTypeId
  })
  await testEventMetadata({
    event: assetTypeUpdatedEvent,
    object: assetTypeAfterWorkflow,
    t,
    patchPayload: {
      metadata: {
        date1: now,
        date2: date2,
        someString: 'wrapped in simple quotes',
        otherString: 'works too',
        otherVar: 'test'
      }
    }
  })
})

test('creates multi-step Stelace workflow with API version', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'workflow:create:all',
      'workflow:read:all',
      'workflowLog:list:all',
    ]
  })
  const apiVersion = '2019-05-20'
  const workflowName = 'Multi-step Workflow'

  const dummyStartDate = new Date().toISOString()
  const startDate = new Date(new Date().getTime() + (1 * 24 * 60 * 60 * 1000)).toISOString()
  const endDate = new Date(new Date().getTime() + (8 * 24 * 60 * 60 * 1000)).toISOString()

  const { body: workflow } = await request(t.context.serverUrl)
    .post('/workflows')
    .set(authorizationHeaders)
    .send({
      name: workflowName,
      event: 'asset__created',
      context: ['test', 'override'],
      apiVersion,
      computed: {
        assetId: 'asset.id',
        startDate: `'${dummyStartDate}'`, // should be overwritten in first step
        // Simple quotes, like {"property": "'string'"} to test JSON requiring outer double quotes in real use
        endDate: `'${endDate}'`,
        dateComputedOnce: 'new Date().toISOString()',
        isCurrentTest: '_.get(asset, "metadata.multiStepWorkflow")'
      },
      run: [{
        filter: 'asset.quantity === 0 && computed.isCurrentTest',
        endpointMethod: 'POST',
        endpointUri: '/availabilities',
        computed: {
          startDate: `'${startDate}'`, // in computed, string literals must be in quotes
          persistedProperty: "'persistedFromFirstStep'"
        },
        endpointPayload: {
          assetId: 'computed.assetId',
          startDate: 'computed.startDate',
          endDate: 'computed.endDate',
          quantity: 1,
          metadata: {
            dateComputedOnce: 'computed.dateComputedOnce',
            envVar: 'env.TEST_ENV_VARIABLE', // 'test' context overwritten by 'override' context
            envVarNotOverwritten: 'env.TEST_ENV_VARIABLE_2', // not overwritten
            automatedAvailability: true
          }
        }
      }, {
        endpointMethod: 'PATCH',
        endpointUri: '/assets/${asset.id}',
        computed: {
          startDate: 'computed.startDate', // overwrites itself
          assetId: 'asset.id',
          manualApproval: 'asset.price >= 20' // true
        },
        filter: 'asset.quantity === 0',
        endpointPayload: {
          metadata: {
            automatedAvailability: true,
            persistedFromFirstStep: 'computed.persistedProperty', // internally not the same way to get value as below
            persistedFromFirstStepWithHelper: '_.get(computed, "persistedProperty")',
            // should be the same as in first step since new Date() must not be re-evaluated
            dateComputedOnce: 'computed.dateComputedOnce',
            startDate: 'computed.startDate', // should still be there
            envVar: 'env.TEST_ENV_VARIABLE',
            otherEnvVar: 'env.OTHER_ENV_VARIABLE'
          },
          platformData: {
            staffApprovalRequired: 'computed.manualApproval', // …true
            approvalAvailabilityId: 'lastResponses[0].id', // risky, should use _.get
            approvalAvailabilityStartDate: '_.get(lastResponses, "[0].startDate")'
          }
        }
      }]
    })
    .expect(200)

  t.is(workflow.name, workflowName)

  const dummyAssetId = 'ast_0TYM7rs1OwP1gQRuCOwP'
  const availabilityAuthorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'availability:list:all'
    ]
  })
  const assetAuthorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'asset:create:all',
      'asset:read:all',
      'asset:edit:all',
      'platformData:edit:all'
    ]
  })
  const eventAuthorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'event:list:all'
    ]
  })

  const { body: { results: initialEvents } } = await request(t.context.serverUrl)
    .get('/events')
    .set(eventAuthorizationHeaders)
    .expect(200)

  await request(t.context.serverUrl)
    .patch(`/assets/${dummyAssetId}`)
    .set(assetAuthorizationHeaders)
    .send({
      name: 'Asset not triggering multi-step Stelace Workflow'
    })
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, defaultTestDelay))

  // Nothing happened since we don’t listen asset__updated

  const { body: { results: eventsAfterDummy } } = await request(t.context.serverUrl)
    .get('/events')
    .set(eventAuthorizationHeaders)
    .expect(200)

  const newEvents = _.differenceBy(eventsAfterDummy, initialEvents, 'id')
  // No other event than asset__updated + asset__name_changed
  // So we know that no Workflow was triggered
  t.true(newEvents.filter(e => e.objectId === dummyAssetId).reduce((memo, event) => {
    return memo && (
      event.type === 'asset__name_changed' ||
      event.type === 'asset__updated'
    )
  }, true))

  const { body: workflowAfterDummy } = await request(t.context.serverUrl)
    .get(`/workflows/${workflow.id}?logs=`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: { results: workflowLogsAfterDummy } } = await request(t.context.serverUrl)
    .get(`/workflow-logs?workflowId=${workflow.id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(areSameIds(getIds(workflowAfterDummy.logs), getIds(workflowLogsAfterDummy)))

  const afterDummyLogs = workflowAfterDummy.logs.filter(
    log => log.metadata.eventObjectId === dummyAssetId
  )
  const workflowAfterDummyErrorLogs = workflowAfterDummy.logs.filter(isErrorLog)
  const workflowAfterDummyActions = workflowAfterDummy.logs.filter(isActionLog)

  t.is(workflowAfterDummyErrorLogs.length, 0)
  t.is(workflowAfterDummyActions.length, 0)
  t.is(workflowAfterDummy.stats.nbActionsCompleted, 0)
  // Workflow events from concurrent tests can trigger this workflow
  // t.is(workflowAfterDummy.stats.nbTimesRun, 0)
  t.is(workflowAfterDummy.stats.nbWorkflowNotifications, 0) // no notifyUrl
  t.true(afterDummyLogs.every(log => log.metadata.eventObjectId !== dummyAssetId))

  // Create a new asset triggering two-step Workflow

  const { body: asset } = await request(t.context.serverUrl)
    .post('/assets')
    .set(assetAuthorizationHeaders)
    .send({
      name: 'Asset triggering multi-step Stelace Workflow',
      assetTypeId: 'typ_MWNfQps1I3a1gJYz2I3a',
      quantity: 0,
      price: 20,
      metadata: { multiStepWorkflow: true }
    })
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, defaultTestDelay))

  const {
    body:
    { results: availabilitiesAfterWorkflow }
  } = await request(t.context.serverUrl)
    .get(`/availabilities?assetId=${asset.id}`)
    .set(availabilityAuthorizationHeaders)
    .expect(200)

  t.is(availabilitiesAfterWorkflow.length, 1)
  const availabilityAfterWorkflow = availabilitiesAfterWorkflow.find((availability) => {
    return availability.metadata.automatedAvailability === true
  })
  t.truthy(availabilityAfterWorkflow)
  t.is(availabilityAfterWorkflow.quantity, 1)
  t.is(availabilityAfterWorkflow.metadata.envVar, "'Overwritten'")
  t.is(availabilityAfterWorkflow.metadata.envVarNotOverwritten, 'Not overwritten')

  const dateComputedOnceInAvailability = availabilityAfterWorkflow.metadata.dateComputedOnce
  t.truthy(dateComputedOnceInAvailability)

  const { body: assetAfterWorkflow } = await request(t.context.serverUrl)
    .get(`/assets/${asset.id}`)
    .set(assetAuthorizationHeaders)
    .expect(200)

  t.is(asset.id, assetAfterWorkflow.id)
  t.is(asset.metadata.automatedAvailability, undefined)
  t.is(asset.metadata.persistedFromFirstStep, undefined)
  t.is(asset.metadata.dateComputedOnce, undefined)
  t.is(asset.metadata.persistedFromFirstStepWithHelper, undefined)
  t.is(asset.platformData.staffApprovalRequired, undefined)

  t.true(assetAfterWorkflow.updatedDate >= asset.updatedDate)
  t.is(assetAfterWorkflow.metadata.automatedAvailability, true)
  t.is(assetAfterWorkflow.metadata.persistedFromFirstStep, 'persistedFromFirstStep')
  t.is(assetAfterWorkflow.metadata.persistedFromFirstStepWithHelper, 'persistedFromFirstStep')
  t.is(assetAfterWorkflow.platformData.staffApprovalRequired, true)
  t.is(assetAfterWorkflow.metadata.envVar, "'Overwritten'")
  t.is(assetAfterWorkflow.metadata.otherEnvVar, 'Overwritten "too"')

  const dateComputedOnceInAsset = assetAfterWorkflow.metadata.dateComputedOnce
  t.truthy(dateComputedOnceInAsset)
  // Must remain the same, as _real_ re-computed property in each step would be very unexpected
  // It’s API calls after all, not Vue.js
  t.is(dateComputedOnceInAvailability, dateComputedOnceInAsset)

  const { body: workflowAfterRun } = await request(t.context.serverUrl)
    .get(`/workflows/${workflow.id}?logs=`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: { results: workflowLogsAfterRun } } = await request(t.context.serverUrl)
    .get(`/workflow-logs?workflowId=${workflow.id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(areSameIds(getIds(workflowAfterRun.logs), getIds(workflowLogsAfterRun)))

  const workflowAfterRunErrorLogs = workflowAfterRun.logs.filter(isErrorLog)
  const workflowAfterRunActions = workflowAfterRun.logs.filter(isActionLog)

  t.is(workflowAfterRunErrorLogs.length, 0)
  t.is(workflowAfterRunActions.length, 2)
  t.is(workflowAfterRun.stats.nbActionsCompleted, 2)
  t.true(workflowAfterRun.stats.nbTimesRun >= 1) // We don’t know how much exactly
  // since we run tests concurrently and filtered runs are counted too
  t.is(workflowAfterRun.stats.nbWorkflowNotifications, 0) // no notifyUrl
  const workflowAfterRunCall1 = workflowAfterRunActions[1]
  t.is(workflowAfterRunCall1.metadata.eventObjectId, asset.id)
  t.is(workflowAfterRunCall1.metadata.endpointMethod, 'POST')
  t.is(workflowAfterRunCall1.metadata.endpointUri, '/availabilities')
  t.is(workflowAfterRunCall1.metadata.endpointPayload.quantity, 1)
  t.is(workflowAfterRunCall1.metadata.endpointPayload.startDate, startDate)
  t.is(workflowAfterRunCall1.metadata.endpointPayload.endDate, endDate)
  t.is(workflowAfterRunCall1.metadata.endpointPayload.metadata.automatedAvailability, true)

  const workflowAfterRunCall2 = workflowAfterRunActions[0]
  t.is(workflowAfterRunCall2.metadata.eventObjectId, asset.id)
  t.is(workflowAfterRunCall2.metadata.endpointMethod, 'PATCH')
  t.is(workflowAfterRunCall2.metadata.endpointUri, `/assets/${asset.id}`)

  const expectedCall2AssetPayload = {
    metadata: {
      automatedAvailability: true,
      startDate,
      persistedFromFirstStep: 'persistedFromFirstStep',
      persistedFromFirstStepWithHelper: 'persistedFromFirstStep',
      dateComputedOnce: dateComputedOnceInAsset,
      envVar: "'Overwritten'",
      otherEnvVar: 'Overwritten "too"'
    },
    platformData: {
      staffApprovalRequired: true,
      approvalAvailabilityId: availabilityAfterWorkflow.id,
      approvalAvailabilityStartDate: startDate
    }
  }

  t.deepEqual(workflowAfterRunCall2.metadata.endpointPayload, expectedCall2AssetPayload)

  // Test events generated by two-step Workflow

  const { body: { results: events } } = await request(t.context.serverUrl)
    .get('/events')
    .set(eventAuthorizationHeaders)
    .expect(200)

  // Step 1: POST availability
  const availabilityCreatedEvent = getObjectEvent({
    events,
    eventType: 'availability__created',
    objectId: availabilityAfterWorkflow.id
  })
  await testEventMetadata({
    event: availabilityCreatedEvent,
    object: availabilityAfterWorkflow,
    t,
    patchPayload: {
      startDate,
      endDate,
      quantity: 1,
      metadata: {
        dateComputedOnce: dateComputedOnceInAvailability,
        automatedAvailability: true,
        envVar: "'Overwritten'",
        envVarNotOverwritten: 'Not overwritten'
      }
    }
  })

  // Step 2: PATCH Asset (itself)
  const assetUpdatedEvent = getObjectEvent({
    events,
    eventType: 'asset__updated',
    objectId: assetAfterWorkflow.id
  })
  await testEventMetadata({
    event: assetUpdatedEvent,
    object: assetAfterWorkflow,
    t,
    patchPayload: expectedCall2AssetPayload
  })
})

test('creates multi-step workflow triggered by custom events and calling external endpoint', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'workflow:create:all',
      'workflow:read:all',
      'workflowLog:list:all',
      'event:create:all',
      'asset:read:all'
    ]
  })
  const workflowName = 'Custom event workflow'

  const { body: workflowCustomEvent } = await request(t.context.serverUrl)
    .post('/workflows')
    .set(authorizationHeaders)
    .send({
      name: workflowName,
      notifyUrl: userWebhookUrl + 'workflowCustomEvent',
      event: 'asset_viewed',
      computed: {
        assetId: 'metadata.assetId'
      },
      run: [{
        // should be true, check if asset is correctly loaded (object loaded from custom event)
        filter: 'computed.assetId === _.get(asset, "id")',
        endpointMethod: 'GET',
        endpointUri: '/assets/${computed.assetId}'
      },
      {
        endpointMethod: 'POST',
        endpointUri: userWebhookUrl + 'workflowCustomEventHeaders',
        endpointHeaders: {
          'X-Custom-Header': '{ \"custom\": \"content\" }', // eslint-disable-line
          'x-webhook-source': 'should not overwrite internally generated header'
        }
      },
      {
        endpointMethod: 'GET',
        endpointUri: 'https://api.stelace.com'
      },
      {
        endpointMethod: 'PATCH',
        // Template string allowed in endpointUri and endpointHeaders
        // to inject any objectId directly or through computed
        endpointUri: '/assets/${computed.assetId}',
        endpointHeaders: {
          'x-platform-id': '${computed.assetId}: ignored, and does not trigger an error',
          'x-custom-header': 'anything string is ok'
        },
        endpointPayload: JSON.stringify({
          metadata: {
            // Responses ars sorted from last to oldest
            nbViews: '_.get(lastResponses, "[2].metadata.nbViews", 0) + 1',
            stelaceGreeting: '_.get(lastResponses, "[0].message")'
          }
        })
      }]
    })
    .expect(200)

  t.is(workflowCustomEvent.name, workflowName)
  t.is(typeof workflowCustomEvent.run[3].endpointPayload, 'object')
  t.is(userServerCalls.workflowCustomEvent, undefined)
  t.is(userServerCallsHeaders.workflowCustomEventHeaders, undefined)

  const assetId = 'ast_0KAm3He1ze11iSSR4ze0'

  // Trigger workflow

  await request(t.context.serverUrl)
    .post('/events')
    .set({
      authorization: `Basic ${encodeBase64('seck_live_iuJzTKo5wumuE1imSjmcgimR:')}`,
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      type: 'asset_viewed',
      objectId: assetId,
      metadata: {
        assetId
      }
    })
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, defaultTestDelay))

  t.is(userServerCalls.workflowCustomEvent.length, 1)
  t.is(userServerCallsHeaders.workflowCustomEventHeaders.length, 1)
  const headersSent = userServerCallsHeaders.workflowCustomEventHeaders[0]
  t.is(headersSent['x-custom-header'], '{ "custom": "content" }') // lower cased header
  t.is(headersSent['x-webhook-source'], 'stelace') // preserved

  const { body: workflowCustomEventAfterRun } = await request(t.context.serverUrl)
    .get(`/workflows/${workflowCustomEvent.id}?logs=`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: { results: workflowLogsAfterRun } } = await request(t.context.serverUrl)
    .get(`/workflow-logs?workflowId=${workflowCustomEvent.id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(areSameIds(getIds(workflowCustomEventAfterRun.logs), getIds(workflowLogsAfterRun)))

  const workflowCustomEventAfterRunErrorLogs = workflowCustomEventAfterRun.logs.filter(isErrorLog)
  const workflowCustomEventAfterRunActions = workflowCustomEventAfterRun.logs.filter(isActionLog)

  t.is(workflowCustomEventAfterRunErrorLogs.length, 0)
  t.is(workflowCustomEventAfterRunActions.length, workflowCustomEvent.run.length)

  const workflowCustomEventLogsCall = workflowCustomEventAfterRunActions[0]
  t.is(workflowCustomEventLogsCall.metadata.endpointMethod, 'PATCH')
  t.is(workflowCustomEventLogsCall.metadata.endpointUri, `/assets/${assetId}`)
  t.truthy(workflowCustomEventLogsCall.metadata.endpointPayload.metadata.stelaceGreeting)

  const workflowCustomEventHeaders = workflowCustomEventLogsCall.metadata.endpointHeaders
  t.true(workflowCustomEventHeaders['x-platform-id'].includes('ignored, and does not trigger an error'))
  t.true(workflowCustomEventHeaders['x-platform-id'].startsWith('ast_')) // template string parsed
  t.is(workflowCustomEventHeaders['x-custom-header'], 'anything string is ok')

  // No other Workflow can trigger this one as long as they don’t emit 'asset_viewed' custom event
  t.deepEqual(workflowCustomEventAfterRun.stats, {
    nbTimesRun: 1,
    nbActionsCompleted: workflowCustomEvent.run.length,
    nbActions: workflowCustomEvent.run.length,
    nbWorkflowNotifications: 1
  })

  const { body: asset } = await request(t.context.serverUrl)
    .get(`/assets/${assetId}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(asset.metadata.nbViews, 1)
  t.true(asset.metadata.stelaceGreeting.includes('/docs'))
})

test('keeps filtered workflow running when handleErrors option is enabled in erroneous step', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'workflow:create:all',
      'workflow:edit:all',
      'workflow:read:all',
      'workflowLog:list:all',
      'event:create:all',
      'asset:read:all'
    ]
  })
  const workflowName = 'workflowHandlingErrors'
  const notifyUrl = userWebhookUrl + workflowName
  const assetName = 'Workflow Asset - handleErrors enabled'
  const assetDescription = 'handleErrors test description'

  const { body: workflowHandlingErrors } = await request(t.context.serverUrl)
    .post('/workflows')
    .set(authorizationHeaders)
    .send({
      name: workflowName,
      notifyUrl,
      event: 'test_handleErrors',
      computed: {
        filter: 'true'
      },
      run: [{
        filter: 'computed.filter',
        name: 'createAsset',
        endpointMethod: 'POST',
        endpointUri: '/assets',
        endpointPayload: {
          name: 'metadata.assetName',
          description: 'metadata.assetDescription'
        }
      },
      {
        name: 'skippedError',
        skip: 'lastResponses[0].description', // truthy
        stop: 'lastResponses[0].category', // falsy
        endpointMethod: 'POST',
        endpointUri: '/assets',
        endpointPayload: {
          invalidBody: true
        }
      },
      {
        name: 'handledError',
        handleErrors: true,
        endpointMethod: 'GET',
        endpointUri: '/unknown'
      },
      {
        computed: {
          assetId: 'responses.createAsset.id' // referring to named step response
        },
        // Checking that statusCode is available in filters
        filter: 'statusCode === 404',
        skip: 'statusCode !== 404',
        endpointMethod: 'PATCH',
        endpointUri: '/assets/${responses.createAsset.id}',
        endpointPayload: {
          metadata: {
            patched: true,
            assetId: 'computed.assetId',
            handledStatusCode: 'statusCode',
            // lastResponses ars sorted from last to oldest
            // skipped step are NOT included, unlike stopping steps or steps with errors
            // That’s why using named steps (and responses) is preferred.
            assetName: '_.get(lastResponses, "[1].name")',
            // expected to be null
            lastResponse: 'lastResponses[0]'
          }
        }
      }]
    })
    .expect(200)

  t.is(workflowHandlingErrors.name, workflowName)
  t.is(userServerCalls[workflowName], undefined)

  // Trigger workflow
  await request(t.context.serverUrl)
    .post('/events')
    .set(authorizationHeaders)
    .send({
      type: 'test_handleErrors',
      metadata: { assetName, assetDescription }
    })
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, defaultTestDelay))

  t.is(userServerCalls[workflowName].length, 1)

  const { body: workflowHandlingErrorsAfterRun } = await request(t.context.serverUrl)
    .get(`/workflows/${workflowHandlingErrors.id}?logs=`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: { results: workflowLogsHandlingErrorsAfterRun } } = await request(t.context.serverUrl)
    .get(`/workflow-logs?workflowId=${workflowHandlingErrors.id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(areSameIds(getIds(workflowHandlingErrorsAfterRun.logs), getIds(workflowLogsHandlingErrorsAfterRun)))

  const afterRunLogs = workflowHandlingErrorsAfterRun.logs
  const afterRunErrorLogs = afterRunLogs.filter(isErrorLog)
  const afterRunActions = afterRunLogs.filter(l => isActionLog(l) || isSkippedLog(l))

  t.is(afterRunErrorLogs.length, 1)
  t.is(afterRunErrorLogs[0].statusCode, 404)
  t.is(afterRunErrorLogs[0].step.name, 'handledError')
  t.is(afterRunActions.length, workflowHandlingErrors.run.length - 1)
  t.truthy(afterRunLogs.find(l => !isErrorLog(l) && l.step.name === 'skippedError'))

  let lastAction = afterRunActions[0]
  t.is(lastAction.metadata.endpointMethod, 'PATCH')
  t.is(lastAction.statusCode, 200)
  t.deepEqual(lastAction.step, {
    name: null,
    handleErrors: false
  })

  const assetId = lastAction.metadata.endpointPayload.metadata.assetId
  t.truthy(assetId)

  // No other Workflow can trigger this one as long as they don’t emit 'test_handleErrors' custom event
  t.deepEqual(workflowHandlingErrorsAfterRun.stats, {
    nbTimesRun: 1,
    nbActionsCompleted: workflowHandlingErrors.run.length - 1, // 1 skipped step
    nbActions: workflowHandlingErrors.run.length,
    nbWorkflowNotifications: 1
  })

  const { body: asset } = await request(t.context.serverUrl)
    .get(`/assets/${assetId}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(asset.metadata.patched, true)
  t.is(asset.metadata.assetName, assetName)
  t.is(asset.metadata.handledStatusCode, 404)
  // Stelace API response
  t.is(asset.metadata.lastResponse.message, '/unknown does not exist')

  // Setting handleErrors back to false default value must stop the workflow
  // in first erroneous (and not skipped) step
  const workflowRunNotHandlingErrors = _.cloneDeep(workflowHandlingErrors.run)
  workflowRunNotHandlingErrors[2].handleErrors = false
  workflowRunNotHandlingErrors[2].name = 'unhandledError'
  await request(t.context.serverUrl)
    .patch(`/workflows/${workflowHandlingErrors.id}`)
    .set(authorizationHeaders)
    .send({ run: workflowRunNotHandlingErrors })

  // Trigger workflow
  await request(t.context.serverUrl)
    .post('/events')
    .set(authorizationHeaders)
    .send({
      type: 'test_handleErrors',
      metadata: {
        assetName: `${assetName} - 2`,
        assetDescription: 'notHandlingErrorsAnymore'
      }
    })
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, defaultTestDelay))

  t.is(userServerCalls[workflowName].length, 2)

  const { body: workflowNotHandlingErrorsAfterRun } = await request(t.context.serverUrl)
    .get(`/workflows/${workflowHandlingErrors.id}?logs=`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: { results: workflowLogsNotHandlingErrorsAfterRun } } = await request(t.context.serverUrl)
    .get(`/workflow-logs?workflowId=${workflowHandlingErrors.id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(areSameIds(getIds(workflowNotHandlingErrorsAfterRun.logs), getIds(workflowLogsNotHandlingErrorsAfterRun)))

  const notHandlingErrLogs = workflowNotHandlingErrorsAfterRun.logs.filter(
    l => l.runId !== lastAction.runId
  )
  const notHandlingErrErrorLogs = notHandlingErrLogs.filter(isErrorLog)
  const notHandlingErrActions = notHandlingErrLogs.filter(
    log => isActionLog(log) || isSkippedLog(log) || isStoppedLog(log)
  )
  t.is(notHandlingErrErrorLogs.length, 1)
  t.is(notHandlingErrErrorLogs[0].statusCode, 404)
  t.is(notHandlingErrErrorLogs[0].step.name, 'unhandledError')

  lastAction = notHandlingErrActions[0]
  // last Workflow step (PATCH) is not executed after workflow being interrupted by error
  t.is(lastAction.metadata.endpointMethod, 'POST')
  // not logged as an error since erroneous code was skipped
  t.is(lastAction.step.name, 'skippedError')
  t.is(lastAction.type, 'skipped')
})

test('creates workflow and uses related objects', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'workflow:create:all',
      'workflow:read:all',
      'workflowLog:list:all',
      'transaction:read:all',
      'transaction:edit:all',
      'transaction:config:all'
    ]
  })
  const workflowName = 'Related objects workflow'

  const { body: workflowRelatedObjects } = await request(t.context.serverUrl)
    .post('/workflows')
    .set(authorizationHeaders)
    .send({
      name: workflowName,
      event: 'transaction__status_changed',
      computed: {
        transactionId: 'transaction.id',
        transactionStatus: 'transaction.status',
        ownerDisplayName: 'owner.displayName',
        takerDisplayName: 'taker.displayName',
      },
      run: [{
        filter: 'computed.transactionStatus === "customStatus"',
        endpointMethod: 'PATCH',
        endpointUri: '/transactions/${computed.transactionId}',
        endpointPayload: JSON.stringify({
          metadata: {
            ownerDisplayName: 'computed.ownerDisplayName',
            takerDisplayName: 'computed.takerDisplayName'
          }
        })
      }]
    })
    .expect(200)

  t.is(workflowRelatedObjects.name, workflowName)
  t.is(typeof workflowRelatedObjects.run[0].endpointPayload, 'object')

  const transactionId = 'trn_ph6nyKe15hU1hU0Wz5hU'

  // Trigger workflow

  await request(t.context.serverUrl)
    .patch(`/transactions/${transactionId}`)
    .set(authorizationHeaders)
    .send({
      status: 'customStatus'
    })
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, defaultTestDelay))

  const { body: workflowRelatedObjectsAfterRun } = await request(t.context.serverUrl)
    .get(`/workflows/${workflowRelatedObjects.id}?logs=`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: { results: workflowLogsRelatedObjectsAfterRun } } = await request(t.context.serverUrl)
    .get(`/workflow-logs?workflowId=${workflowRelatedObjects.id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(areSameIds(getIds(workflowRelatedObjectsAfterRun.logs), getIds(workflowLogsRelatedObjectsAfterRun)))

  const workflowRelatedObjectsAfterRunErrorLogs = workflowRelatedObjectsAfterRun.logs.filter(isErrorLog)
  const workflowRelatedObjectsAfterRunActions = workflowRelatedObjectsAfterRun.logs.filter(isActionLog)

  t.is(workflowRelatedObjectsAfterRunErrorLogs.length, 0)
  t.is(workflowRelatedObjectsAfterRunActions.length, workflowRelatedObjects.run.length)

  const workflowRelatedObjectsLogsCall = workflowRelatedObjectsAfterRunActions[0]
  t.is(workflowRelatedObjectsLogsCall.metadata.endpointMethod, 'PATCH')
  t.is(workflowRelatedObjectsLogsCall.metadata.endpointUri, `/transactions/${transactionId}`)
  t.truthy(workflowRelatedObjectsLogsCall.metadata.endpointPayload.metadata.ownerDisplayName)
  t.truthy(workflowRelatedObjectsLogsCall.metadata.endpointPayload.metadata.takerDisplayName)

  // No other Workflow can trigger this one as long as they don’t emit 'transaction__status_changed' custom event
  t.deepEqual(workflowRelatedObjectsAfterRun.stats, {
    nbTimesRun: 1,
    nbActionsCompleted: workflowRelatedObjects.run.length,
    nbActions: workflowRelatedObjects.run.length,
    nbWorkflowNotifications: 0
  })

  const { body: transaction } = await request(t.context.serverUrl)
    .get(`/transactions/${transactionId}`)
    .set(authorizationHeaders)
    .expect(200)

  t.truthy(transaction.metadata.ownerDisplayName)
  t.truthy(transaction.metadata.takerDisplayName)
})

test('accepts nested arrays of literals as endpoint payload parameters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'workflow:read:all',
      'workflow:create:all',
      'workflowLog:list:all',
    ]
  })
  const workflowName = 'Workflow test array'
  const username = `user${_.uniqueId()}@example.com`
  const customAttributeId = 'attr_SWtQps1I3a1gJYz2I3a'

  const { body: workflowTestArray } = await request(t.context.serverUrl)
    .post('/workflows')
    .set(authorizationHeaders)
    .send({
      name: workflowName,
      notifyUrl: userWebhookUrl + 'workflowTestArray',
      event: 'user__created',
      computed: {
        isCurrentTest: `_.get(user, "metadata.workflowName") === '${workflowName}'`
      },
      run: {
        filter: 'computed.isCurrentTest',
        endpointMethod: 'PATCH',
        computed: {
          customAttributeId: '_.get(user, "metadata.customAttributeId")',
          test: '"computed".split(\'\').join(\'\')'
        },
        endpointUri: '/custom-attributes/${computed.customAttributeId}',
        endpointPayload: JSON.stringify({ // simulate real API call (string JSON only)
          listValues: ['"Toyota"', '"Chevrolet"'], // In array literal, strings need nested quotes to avoid being evaluated as JS
          metadata: {
            quotedArray: '["unique", "quotes"]', // Cleaner way to pass array of strings than nesting quotes
            computedArray: ['computed.test'], // computed gets evaluated (no nested quotes)
            computedArray2: '[computed.test]', // Same
            nestedArray: [['"inception"'], '"test"', 'computed.test', 1, { object: true }] // literals are accepted too
            // note that string must be double-quoted to avoid being evaluated as JS like 'computed.test'
          }
        })
      }
    })
    .expect(200)

  t.is(workflowTestArray.name, workflowName)
  t.is(typeof workflowTestArray.run[0].endpointPayload, 'object')
  t.is(userServerCalls.workflowTestArray, undefined)

  // Trigger workflow

  await request(t.context.serverUrl)
    .post('/users')
    .set({
      authorization: `Basic ${encodeBase64('seck_live_iuJzTKo5wumuE1imSjmcgimR:')}`,
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      username,
      password: username,
      metadata: { workflowName, customAttributeId }
    })
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, defaultTestDelay))

  t.is(userServerCalls.workflowTestArray.length, 1)

  const { body: workflowTestArrayAfterRun } = await request(t.context.serverUrl)
    .get(`/workflows/${workflowTestArray.id}?logs=`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: { results: workflowLogsTestArrayAfterRun } } = await request(t.context.serverUrl)
    .get(`/workflow-logs?workflowId=${workflowTestArray.id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(areSameIds(getIds(workflowTestArrayAfterRun.logs), getIds(workflowLogsTestArrayAfterRun)))

  const workflowTestArrayAfterRunErrorLogs = workflowTestArrayAfterRun.logs.filter(isErrorLog)
  const workflowTestArrayAfterRunActions = workflowTestArrayAfterRun.logs.filter(isActionLog)

  t.is(workflowTestArrayAfterRunErrorLogs.length, 0)
  t.is(workflowTestArrayAfterRunActions.length, 1)
  const workflowTestArrayLogsCall = workflowTestArrayAfterRunActions[0]
  t.is(workflowTestArrayLogsCall.metadata.endpointMethod, 'PATCH')
  t.is(workflowTestArrayLogsCall.metadata.endpointUri, `/custom-attributes/${customAttributeId}`)
  t.deepEqual(workflowTestArrayLogsCall.metadata.endpointPayload.listValues, ['Toyota', 'Chevrolet'])
  t.deepEqual(workflowTestArrayLogsCall.metadata.endpointPayload.metadata.quotedArray, ['unique', 'quotes'])
  t.deepEqual(workflowTestArrayLogsCall.metadata.endpointPayload.metadata.computedArray, ['computed'])
  t.deepEqual(workflowTestArrayLogsCall.metadata.endpointPayload.metadata.computedArray2, ['computed'])
  t.deepEqual(workflowTestArrayLogsCall.metadata.endpointPayload.metadata.nestedArray, [
    ['inception'],
    'test',
    'computed',
    1,
    { object: true }
  ])
  const stats = workflowTestArrayAfterRun.stats
  t.is(stats.nbActionsCompleted, 1)
  t.is(stats.nbTimesRun, stats.nbWorkflowNotifications)
  t.true(stats.nbTimesRun >= 1)
})

test('accepts nested object as endpoint payload parameters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'workflow:read:all',
      'workflow:create:all',
      'workflowLog:list:all',
    ]
  })
  const workflowName = 'Workflow test nested object'

  const { body: workflowTestNestedObject } = await request(t.context.serverUrl)
    .post('/workflows')
    .set(authorizationHeaders)
    .send({
      name: workflowName,
      notifyUrl: userWebhookUrl + 'workflowTestNestedObject',
      event: 'asset_type__created',
      run: {
        endpointMethod: 'PATCH',
        computed: {
          assetTypeId: 'assetType.id'
        },
        endpointUri: '/asset-types/${computed.assetTypeId}',
        endpointPayload: JSON.stringify({
          metadata: {
            nestedParent: {
              nestedChild: {
                test: true
              }
            }
          }
        })
      }
    })
    .expect(200)

  t.is(workflowTestNestedObject.name, workflowName)
  t.is(typeof workflowTestNestedObject.run[0].endpointPayload, 'object')
  t.is(userServerCalls.workflowTestNestedObject, undefined)

  // Trigger workflow

  const { body: assetType } = await request(t.context.serverUrl)
    .post('/asset-types')
    .set({
      authorization: `Basic ${encodeBase64('seck_live_iuJzTKo5wumuE1imSjmcgimR:')}`,
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: 'Created Asset Type triggering Workflow',
      timeBased: true,
      infiniteStock: false,
      metadata: { workflowName }
    })
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, defaultTestDelay))

  t.is(userServerCalls.workflowTestNestedObject.length, 1)

  const { body: workflowTestNestedObjectAfterRun } = await request(t.context.serverUrl)
    .get(`/workflows/${workflowTestNestedObject.id}?logs=`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: { results: workflowLogsTestNestedObjectAfterRun } } = await request(t.context.serverUrl)
    .get(`/workflow-logs?workflowId=${workflowTestNestedObject.id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(areSameIds(getIds(workflowTestNestedObjectAfterRun.logs), getIds(workflowLogsTestNestedObjectAfterRun)))

  const workflowTestNestedObjectAfterRunErrorLogs = workflowTestNestedObjectAfterRun.logs.filter(isErrorLog)
  const workflowTestNestedObjectAfterRunActions = workflowTestNestedObjectAfterRun.logs.filter(isActionLog)

  t.is(workflowTestNestedObjectAfterRunErrorLogs.length, 0)
  t.is(workflowTestNestedObjectAfterRunActions.length, 1)
  const workflowTestNestedObjectLogsCall = workflowTestNestedObjectAfterRunActions[0]
  t.is(workflowTestNestedObjectLogsCall.metadata.endpointMethod, 'PATCH')
  t.is(workflowTestNestedObjectLogsCall.metadata.endpointUri, `/asset-types/${assetType.id}`)
  t.deepEqual(workflowTestNestedObjectLogsCall.metadata.endpointPayload.metadata, {
    nestedParent: {
      nestedChild: {
        test: true
      }
    }
  })
  const stats = workflowTestNestedObjectAfterRun.stats
  t.is(stats.nbActionsCompleted, 1)
  t.is(stats.nbTimesRun, stats.nbWorkflowNotifications)
  t.true(stats.nbTimesRun >= 1)
})

/*
Testing asset__updated ==> Workflow A (logs x1 state to update from x0 state with no logs)
==> Some action & PATCH (update) same asset
==> Workflow A running again (logs x2 to add, should add to x1 logs but can add to x0 state with race condition
    in particular if Workflow A has several steps_)

These tests of logs urged to create a new workflowLog table handling concurrency.
*/
test('handles filters and logs errors properly when executing Stelace Workflow', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'workflow:create:all',
      'workflow:edit:all',
      'workflow:read:all',
      'workflowLog:list:all',
      'user:read:all',
      'user:edit:all'
    ],
    readNamespaces: ['private']
  })
  const workflowName = 'User Updated Workflow'
  const userId = 'usr_Y0tfQps1I3a1gJYz2I3a'
  const newUsername = 'Workflow Test User (user)'

  const { body: workflow } = await request(t.context.serverUrl)
    .post('/workflows')
    .set(authorizationHeaders)
    .send({
      name: workflowName,
      event: 'user__updated',
      computed: {
        isCurrentTest: `_.get(changesRequested, "metadata.workflowName") === '${workflowName}'`,
        hasSalesCallDate: '_.get(user, "metadata.salesCallDate")' // falsy since no salesCallDate is set yet
      },
      run: [{
        filter: 'computed.isCurrentTest && !computed.hasSalesCallDate',
        // handleErrors: false, // default, changed below to check we can reach step 2 despite error
        endpointMethod: 'PATCH',
        endpointUri: '/users/${user.id}',
        computed: {
          workflowSelfUpdate: '!!_.get(changesRequested, "metadata.salesCallDate")'
        },
        endpointPayload: {
          invalidAttribute: true, // will trigger 400 error
          metadata: {
            salesCallDate: 'new Date(new Date().getTime() + (72 * 60 * 60 * 1000)).toISOString()'
          }
        }
      },
      {
        endpointMethod: 'POST',
        endpointUri: '/assets',
        endpointPayload: {
          name: '`${user.username || "user"}’s asset`',
          assetTypeId: 'typ_MWNfQps1I3a1gJYz2I3a', // syntax error, missing quotes
          ownerId: 'user.id'
        },
        // dummy truthy value
        filter: 'true'
      }]
    })
    .expect(200)

  // Trigger Workflow
  await request(t.context.serverUrl)
    .patch(`/users/${userId}`)
    .set(authorizationHeaders)
    .send({
      username: newUsername,
      metadata: { workflowName }
    })
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, defaultTestDelay))

  const { body: userAfterStepsErrors } = await request(t.context.serverUrl)
    .get(`/users/${userId}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(userAfterStepsErrors.username, newUsername)
  t.deepEqual(Object.values(userAfterStepsErrors.metadata), [workflowName])

  const { body: workflowAfterStepsErrors } = await request(t.context.serverUrl)
    .get(`/workflows/${workflow.id}?logs=`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: { results: workflowLogsAfterStepsErrors } } = await request(t.context.serverUrl)
    .get(`/workflow-logs?workflowId=${workflow.id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(areSameIds(getIds(workflowAfterStepsErrors.logs), getIds(workflowLogsAfterStepsErrors)))

  // Exclude any log due to workflow events from concurrent tests
  const afterStepsErrorsLogs = workflowAfterStepsErrors.logs.filter(
    log => log.metadata.eventObjectId === userId
  )
  // Workflow got stopped after step 1 error as expected (handleErrors defaults to false)
  t.is(afterStepsErrorsLogs.length, 1)

  let lastErrorLog = afterStepsErrorsLogs[0]
  const AfterStepsErrorsRunId = afterStepsErrorsLogs[0].runId
  t.truthy(typeof AfterStepsErrorsRunId, 'string')
  t.is(AfterStepsErrorsRunId.length, 36)
  t.is(lastErrorLog.type, 'runError')
  t.is(lastErrorLog.statusCode, 400)
  t.is(lastErrorLog.metadata.endpointMethod, 'PATCH')

  // These are automatically populated after error
  t.regex(lastErrorLog.metadata.statusCodeName, /Bad Request/i)
  t.regex(lastErrorLog.metadata.message, /invalidattribute/i)

  t.is(lastErrorLog.metadata.eventObjectId, userId)
  t.is(Object.keys(lastErrorLog.metadata.endpointPayload).length, 2)
  t.true(lastErrorLog.metadata.endpointPayload.invalidAttribute)

  const workflowAfterStepsErrorsLogs = afterStepsErrorsLogs.filter(log => log.type === 'runError')
  // no successful action
  t.is(workflowAfterStepsErrorsLogs.length, afterStepsErrorsLogs.length)

  t.is(workflowAfterStepsErrors.stats.nbActionsCompleted, 0)
  // Workflow events from concurrent tests can trigger this workflow
  t.true(workflowAfterStepsErrors.stats.nbTimesRun >= 1)

  // Setting handleErrors to true to execute first step despite error and move to second

  const runWithHandleErrorsEnabled = _.cloneDeep(workflow.run)
  runWithHandleErrorsEnabled[0].handleErrors = true
  await request(t.context.serverUrl)
    .patch(`/workflows/${workflow.id}`)
    .set(authorizationHeaders)
    .send({ run: runWithHandleErrorsEnabled })

  // Trigger Workflow
  await request(t.context.serverUrl)
    .patch(`/users/${userId}`)
    .set(authorizationHeaders)
    .send({
      username: `${newUsername} - Handling errors`,
      metadata: { workflowName }
    })
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, defaultTestDelay))

  const { body: userWithHandleErrorsEnabled } = await request(t.context.serverUrl)
    .get(`/users/${userId}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(userWithHandleErrorsEnabled.username, `${newUsername} - Handling errors`)

  const { body: workflowWithHandleErrorsEnabled } = await request(t.context.serverUrl)
    .get(`/workflows/${workflow.id}?logs=`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: { results: workflowLogsWithHandleErrorsEnabled } } = await request(t.context.serverUrl)
    .get(`/workflow-logs?workflowId=${workflow.id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(areSameIds(getIds(workflowWithHandleErrorsEnabled.logs), getIds(workflowLogsWithHandleErrorsEnabled)))

  // Step 2 is started but not executed since it has its own error
  t.is(workflowWithHandleErrorsEnabled.stats.nbActionsCompleted, 1)

  const afterHandleErrorsEnabledLogs = workflowWithHandleErrorsEnabled.logs.filter(
    log => log.metadata.eventObjectId === userId
  )
  const workflowWithHandleErrorsEnabledErrorLogs = afterHandleErrorsEnabledLogs.filter(isErrorLog)
  t.is(workflowWithHandleErrorsEnabledErrorLogs.filter(
    log => log.runId !== AfterStepsErrorsRunId
  ).length, 2)

  lastErrorLog = workflowWithHandleErrorsEnabledErrorLogs[0]
  t.is(lastErrorLog.type, 'preRunError')
  t.is(lastErrorLog.metadata.endpointMethod, 'POST')
  t.true(lastErrorLog.metadata.message.includes('ReferenceError'))
  t.true(lastErrorLog.metadata.message.includes('typ_MWNfQps1I3a1gJYz2I3a is not defined'))

  // Fixing step 2 error to check this step is still filtered out (since step 1 keeps failing)
  // after restoring handleErrors default value

  const runWithPayloadAfterStep2Fix = _.cloneDeep(workflow.run)
  runWithPayloadAfterStep2Fix[1].endpointPayload.assetTypeId = `"${
    runWithPayloadAfterStep2Fix[1].endpointPayload.assetTypeId
  }"`
  await request(t.context.serverUrl)
    .patch(`/workflows/${workflow.id}`)
    .set(authorizationHeaders)
    .send({ run: runWithPayloadAfterStep2Fix })

  // Trigger Workflow
  await request(t.context.serverUrl)
    .patch(`/users/${userId}`)
    .set(authorizationHeaders)
    .send({
      username: `${newUsername} - After Step 2 Fix`,
      metadata: { workflowName }
    })
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, defaultTestDelay))

  const { body: userAfterStep2Fix } = await request(t.context.serverUrl)
    .get(`/users/${userId}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(userAfterStep2Fix.username, `${newUsername} - After Step 2 Fix`)
  t.deepEqual(Object.values(userAfterStep2Fix.metadata), [workflowName])

  const { body: workflowAfterStep2Fix } = await request(t.context.serverUrl)
    .get(`/workflows/${workflow.id}?logs=`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: { results: workflowLogsAfterStep2Fix } } = await request(t.context.serverUrl)
    .get(`/workflow-logs?workflowId=${workflow.id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(areSameIds(getIds(workflowAfterStep2Fix.logs), getIds(workflowLogsAfterStep2Fix)))

  const afterStep2FixLogs = workflowAfterStep2Fix.logs.filter(
    log => log.metadata.eventObjectId === userId
  )
  const workflowAfterStep2FixErrorLogs = afterStep2FixLogs.filter(isErrorLog)
  const AfterStep2FixRunId = workflowAfterStep2FixErrorLogs[0].runId
  t.is(AfterStep2FixRunId.length, 36)
  t.not(AfterStep2FixRunId, AfterStepsErrorsRunId)
  t.is(workflowAfterStep2FixErrorLogs.length, workflowWithHandleErrorsEnabledErrorLogs.length + 1)
  // no successful action, same error as above
  t.is(afterStep2FixLogs.length, workflowAfterStep2FixErrorLogs.length)

  lastErrorLog = workflowAfterStep2FixErrorLogs[0]
  t.is(lastErrorLog.metadata.endpointMethod, 'PATCH')
  t.regex(lastErrorLog.metadata.message, /invalidattribute/i)

  // Fixing step 1 error and see if both steps run smoothly
  const runWithPayloadAfterStepsFixed = _.cloneDeep(workflowAfterStep2Fix.run)
  delete runWithPayloadAfterStepsFixed[0].endpointPayload.invalidAttribute

  await request(t.context.serverUrl)
    .patch(`/workflows/${workflow.id}`)
    .set(authorizationHeaders)
    .send({
      run: runWithPayloadAfterStepsFixed
    })

  // Trigger Workflow
  await request(t.context.serverUrl)
    .patch(`/users/${userId}`)
    .set(authorizationHeaders)
    .send({
      username: `${newUsername} - After Steps 1 & 2 Fixes`,
      metadata: { workflowName }
    })
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, defaultTestDelay))

  const { body: userAfterStepsFixed } = await request(t.context.serverUrl)
    .get(`/users/${userId}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(userAfterStepsFixed.username, `${newUsername} - After Steps 1 & 2 Fixes`)
  t.is(Object.keys(userAfterStepsFixed.metadata).length, 2)
  t.truthy(userAfterStepsFixed.metadata.salesCallDate)

  const { body: workflowAfterStepsFixed } = await request(t.context.serverUrl)
    .get(`/workflows/${workflow.id}?logs=`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: { results: workflowLogsAfterStepsFixed } } = await request(t.context.serverUrl)
    .get(`/workflow-logs?workflowId=${workflow.id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(areSameIds(getIds(workflowAfterStepsFixed.logs), getIds(workflowLogsAfterStepsFixed)))

  const workflowAfterStepsFixedErrorLogs = workflowAfterStepsFixed.logs.filter(isErrorLog)
  const workflowAfterStepsFixedActions = workflowAfterStepsFixed.logs.filter(isActionLog)
  const AfterStepsFixedRunId1 = workflowAfterStepsFixedActions[0].runId
  const AfterStepsFixedRunId2 = workflowAfterStepsFixedActions[1].runId

  // No additional errors
  t.deepEqual(workflowAfterStep2FixErrorLogs, workflowAfterStepsFixedErrorLogs)
  t.is(workflowAfterStepsFixedActions.length, 2)
  t.not(AfterStepsFixedRunId1, AfterStep2FixRunId)
  t.is(AfterStepsFixedRunId1, AfterStepsFixedRunId2)
})

test('passes basic security checks', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'workflow:create:all',
      'workflow:edit:all',
      'workflow:read:all',
      'workflowLog:list:all',
    ]
  })
  const workflowName = 'Evil Workflow'

  const { body: workflow } = await request(t.context.serverUrl)
    .post('/workflows')
    .set(authorizationHeaders)
    .send({
      name: workflowName,
      notifyUrl: userWebhookUrl + 'evil',
      event: 'category__updated',
      computed: {
        patchLodash: '_.get = () => "p4wned"' // lodash should be frozen
      },
      // TODO: test future control of infinite Workflow event loops
      run: [{
        computed: {
          // should be true despite patchLodash attempt
          isCurrentTest: `_.get(changesRequested, "metadata.workflowName") === '${workflowName}'`,
        },
        endpointMethod: 'GET',
        endpointUri: '/assets'
      },
      {
        filter: 'computed.isCurrentTest',
        endpointMethod: 'PATCH',
        computed: {
          forever: '(() => { let i = 0; while (true) { i++ } })()'
        },
        endpointUri: '/categories/${object.id}',
        endpointPayload: {
          name: '"6x6"',
          metadata: { not: 'computed.forever' }
        }
      }]
    })
    .expect(200)

  t.is(workflow.name, workflowName)
  t.is(userServerCalls.evil, undefined)

  const categoryId = 'ctgy_N1FQps1I3a1gJYz2I3a'

  // Trigger

  await request(t.context.serverUrl)
    .patch(`/categories/${categoryId}`)
    .set({
      authorization: `Basic ${encodeBase64('seck_live_iuJzTKo5wumuE1imSjmcgimR:')}`,
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: 'Category triggering evil Workflow (infinite loop)',
      metadata: { workflowName }
    })
    .expect(200)

  // Wait for Workflow run step timeout (max 1000ms per step + some margin)
  await new Promise(resolve => setTimeout(resolve, defaultTestDelay))

  t.is(userServerCalls.evil.length, 1)

  const { body: workflowAfterRun } = await request(t.context.serverUrl)
    .get(`/workflows/${workflow.id}?logs=`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: { results: workflowLogsAfterRun } } = await request(t.context.serverUrl)
    .get(`/workflow-logs?workflowId=${workflow.id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(areSameIds(getIds(workflowAfterRun.logs), getIds(workflowLogsAfterRun)))

  const workflowAfterRunErrorLogs = workflowAfterRun.logs.filter(isErrorLog)
  const workflowAfterRunActions = workflowAfterRun.logs.filter(isActionLog)
  const workflowAfterRunNotifications = workflowAfterRun.logs.filter(isNotificationLog)

  t.is(workflowAfterRunErrorLogs.length, 1)
  t.is(workflowAfterRunActions.length, 1)
  t.is(workflowAfterRunNotifications.length, 1)

  let workflowLastError = workflowAfterRunErrorLogs[0]
  t.true(workflowLastError.metadata.message.includes('timed out'))
  t.is(workflowLastError.statusCode, 422)
  t.is(workflowLastError.metadata.eventObjectId, categoryId)
  t.is(workflowLastError.metadata.endpointMethod, 'PATCH')
  t.is(workflowLastError.metadata.endpointUri, `/categories/${categoryId}`)
  t.is(workflowLastError.metadata.endpointPayload.name, '6x6')
  // No other Workflow can trigger this workflow as long as they don’t update a category
  t.deepEqual(workflowAfterRun.stats, {
    nbTimesRun: 1,
    nbActions: 1,
    nbActionsCompleted: 1,
    nbWorkflowNotifications: 1
  })

  t.is(workflowAfterRunNotifications[0].metadata.notifyPayload.type, 'preRunError')

  const runProcessPatch = workflow.run
  runProcessPatch[0].computed = {
    try: 'S.set.constructor.constructor("return process")().exit()',
    forever: '"no"'
  }

  await request(t.context.serverUrl)
    .patch(`/workflows/${workflow.id}`)
    .set(authorizationHeaders)
    .send({ run: runProcessPatch })
    .expect(200)

  // Trigger

  await request(t.context.serverUrl)
    .patch(`/categories/${categoryId}`)
    .set({
      authorization: `Basic ${encodeBase64('seck_live_iuJzTKo5wumuE1imSjmcgimR:')}`,
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: 'Category triggering evil Workflow (process)',
      metadata: { workflowName }
    })
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, defaultTestDelay))

  const { body: workflowWithProcess } = await request(t.context.serverUrl)
    .get(`/workflows/${workflow.id}?logs=`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: { results: workflowLogsWithProcess } } = await request(t.context.serverUrl)
    .get(`/workflow-logs?workflowId=${workflow.id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(areSameIds(getIds(workflowWithProcess.logs), getIds(workflowLogsWithProcess)))

  const workflowWithProcessErrorLogs = workflowWithProcess.logs.filter(isErrorLog)
  workflowLastError = workflowWithProcessErrorLogs[0]
  t.is(workflowWithProcessErrorLogs.length, 2)
  t.is(workflowLastError.statusCode, 422)
  t.true(workflowLastError.metadata.message.includes('ReferenceError'))
})

test('cannot create a Stelace workflow with multiple events', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['workflow:create:all'] })
  const workflowName = 'Transaction status Workflow'

  await request(t.context.serverUrl)
    .post('/workflows')
    .set(authorizationHeaders)
    .send({
      name: workflowName,
      event: ['asset__updated', 'asset__created'],
      run: [{
        endpointMethod: 'PATCH',
        computed: {
          futurePrice: '_.get(asset, "doesNotExist", 23) + 1',
          assetId: 'asset.id'
        },
        endpointUri: '/assets',
        endpointPayload: {}
      }]
    })
    .expect(400)

  t.pass()
})

test('removes a workflow', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'workflow:read:all',
      'workflow:create:all',
      'workflow:remove:all'
    ]
  })

  const { body: workflow } = await request(t.context.serverUrl)
    .post('/workflows')
    .set(authorizationHeaders)
    .send({
      name: 'Workflow to remove',
      event: 'custom'
    })
    .expect(200)

  const { body: deletePayload } = await request(t.context.serverUrl)
    .delete(`/workflows/${workflow.id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(deletePayload.id, workflow.id)

  await request(t.context.serverUrl)
    .get(`/workflows/${workflow.id}`)
    .set(authorizationHeaders)
    .expect(404)
})

// ////////// //
// VALIDATION //
// ////////// //

test('fails to create a workflow if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .post('/workflows')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // missing required parameters
  result = await request(t.context.serverUrl)
    .post('/workflows')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      run: {
        endpointUri: 'ftp://test.com' // only allow http(s) or stelace endpoint starting with '/'
      }
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"name" is required'))
  t.true(error.message.includes('"run.endpointUri"'))
  t.true(error.message.includes('"ftp://test.com"'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .post('/workflows')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: true,
      description: true,
      context: true,
      notifyUrl: true,
      event: true,
      computed: true,
      run: true,
      active: 'invalid',
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"name" must be a string'))
  t.true(error.message.includes('"description" must be a string'))
  t.true(error.message.includes('"context" must be a string'))
  t.true(error.message.includes('"notifyUrl" must be a string'))
  t.true(error.message.includes('"event" must be a string'))
  t.true(error.message.includes('"computed" must be of type object'))
  t.true(error.message.includes('"run" must be of type object'))
  t.true(error.message.includes('"active" must be a boolean'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

test('fails to create a workflow with an invalid API version', async (t) => {
  await request(t.context.serverUrl)
    .post('/workflows')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: 'Invalid API version workflow',
      apiVersion: '2016-01-01'
    })
    .expect(400)

  t.pass()
})

test('fails to update a workflow if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .patch('/workflows/webh_SEIxTFR4SHMx7koS0txovaA3HlHHMxJ')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .patch('/workflows/webh_SEIxTFR4SHMx7koS0txovaA3HlHHMxJ')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: true,
      description: true,
      context: [true],
      event: true,
      computed: true,
      run: true,
      active: 'invalid',
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"name" must be a string'))
  t.true(error.message.includes('"description" must be a string'))
  t.true(error.message.includes('"context[0]" must be a string'))
  t.true(error.message.includes('"event" must be a string'))
  t.true(error.message.includes('"computed" must be of type object'))
  t.true(error.message.includes('"run" must be of type object'))
  t.true(error.message.includes('"active" must be a boolean'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

test('fails to update a workflow with an invalid API version', async (t) => {
  await request(t.context.serverUrl)
    .patch('/workflows/webh_SEIxTFR4SHMx7koS0txovaA3HlHHMxJ')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      apiVersion: '2016-01-01'
    })
    .expect(400)

  t.pass()
})

// //////// //
// VERSIONS //
// //////// //

test('2019-05-20: list workflows', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['workflow:list:all']
  })

  const { body: workflows } = await request(t.context.serverUrl)
    .get('/workflows')
    .set(authorizationHeaders)
    .expect(200)

  t.true(Array.isArray(workflows))
})

test('2019-05-20: list workflows with custom namespace', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['workflow:list:all'],
    readNamespaces: ['custom']
  })

  const { body: workflows } = await request(t.context.serverUrl)
    .get('/workflows')
    .set(authorizationHeaders)
    .expect(200)

  t.true(Array.isArray(workflows))

  const hasAtLeastOneCustomNamespace = workflows.some(w => typeof w.platformData._custom !== 'undefined')
  t.true(hasAtLeastOneCustomNamespace)
})
