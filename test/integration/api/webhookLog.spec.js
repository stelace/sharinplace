require('dotenv').config()

const test = require('ava')
const request = require('supertest')
const express = require('express')
const bodyParser = require('body-parser')
const _ = require('lodash')

const userServer = express()
let userServerPort
const userServerCalls = {}
let userApp

const { before, beforeEach, after } = require('../../lifecycle')
const { getAccessTokenHeaders } = require('../../auth')
const {
  computeDate,

  checkCursorPaginationScenario,
  checkCursorPaginatedListObject,

  checkFilters,
} = require('../../util')

let userWebhookUrl

const defaultTestDelay = 4000

let createdWebhooks

/* eslint-disable no-template-curly-in-string */

async function createWebhookLogs (t) {
  if (createdWebhooks) return createdWebhooks

  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'webhookLog:list:all',
      'webhook:create:all',
      'category:create:all',
      'entry:create:all',
      'message:create:all',
    ]
  })

  // should create webhooks that listen to events that are not triggered by any tests below

  const { body: messageWebhook } = await request(t.context.serverUrl)
    .post('/webhooks')
    .set(authorizationHeaders)
    .send({
      name: 'Webhook for message creation',
      event: 'message__created',
      targetUrl: userWebhookUrl + 'messageCreation',
    })
    .expect(200)

  const { body: entryWebhook } = await request(t.context.serverUrl)
    .post('/webhooks')
    .set(authorizationHeaders)
    .send({
      name: 'Webhook for entry creation',
      event: 'entry__created',
      targetUrl: userWebhookUrl + 'entryCreation',
    })
    .expect(200)

  createdWebhooks = _.keyBy([
    messageWebhook,
    entryWebhook,
  ], 'event')

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
  await before({ name: 'webhook' })(t)
  await beforeEach()(t)

  userServer.use(bodyParser.json())
  userServer.post('/error', function (req, res) {
    res.status(500).json({ message: 'Webhook target server error' })
  })
  userServer.post('*', function (req, res) {
    const webhookName = req.path.replace('/', '')

    if (!Array.isArray(userServerCalls[webhookName])) userServerCalls[webhookName] = []
    userServerCalls[webhookName].unshift(req.body)

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

  await createWebhookLogs(t)
})
// test.beforeEach(beforeEach()) // concurrent tests are much faster
test.after(async (t) => {
  await after()(t)
  await userApp.close()
})

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('list webhook logs', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['webhookLog:list:all'] })

  await checkCursorPaginationScenario({
    t,
    endpointUrl: '/webhook-logs',
    authorizationHeaders,
  })
})

test('list webhook logs with advanced filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['webhookLog:list:all'] })

  const now = new Date().toISOString()
  const minDate = computeDate(now, '-10d')

  const {
    entry__created: entryWorkflow,
    message__created: messageWorkflow,
  } = createdWebhooks

  const params = `createdDate[gte]=${encodeURIComponent(minDate)}` +
    `&webhookId[]=${entryWorkflow.id}` +
    `&webhookId[]=${messageWorkflow.id}`

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/webhook-logs?${params}`)
    .set(authorizationHeaders)
    .expect(200)

  const checkResultsFn = (t, webhookLog) => {
    t.true(webhookLog.createdDate >= minDate)
    t.true([entryWorkflow.id, messageWorkflow.id].includes(webhookLog.webhookId))
  }

  checkCursorPaginatedListObject(t, obj, { checkResultsFn })
})

// use serial because no changes must be made during the check
test.serial('check list filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['webhookLog:list:all'] })

  await checkFilters({
    t,
    endpointUrl: '/webhook-logs',
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
        prop: 'webhookId',
        isArrayFilter: true,
      },
      {
        prop: 'eventId',
        isArrayFilter: true,
      },
      {
        prop: 'status',
        isArrayFilter: true,
      },
    ],
  })
})

test('finds a webhook log', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'webhookLog:list:all',
      'webhookLog:read:all'
    ]
  })

  const { body: { results: webhookLogs } } = await request(t.context.serverUrl)
    .get('/webhook-logs')
    .set(authorizationHeaders)
    .expect(200)

  const { body: webhookLog } = await request(t.context.serverUrl)
    .get(`/webhook-logs/${webhookLogs[0].id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(webhookLog.id, webhookLogs[0].id)
})
