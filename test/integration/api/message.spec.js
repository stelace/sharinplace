require('dotenv').config()

const test = require('ava')
const request = require('supertest')

const { before, beforeEach, after } = require('../../lifecycle')
const { getAccessTokenHeaders } = require('../../auth')
const {
  getObjectEvent,
  testEventMetadata,

  checkOffsetPaginationScenario,
  checkOffsetPaginatedListObject,

  checkCursorPaginationScenario,
  checkCursorPaginatedListObject,

  checkFilters,
} = require('../../util')

test.before(async t => {
  await before({ name: 'message' })(t)
  await beforeEach()(t)
})
// test.beforeEach(beforeEach()) // Concurrent tests are much faster
test.after(after())

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('list messages with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['message:list:all'] })

  await checkCursorPaginationScenario({
    t,
    endpointUrl: '/messages',
    authorizationHeaders,
  })
})

// use serial because no changes must be made during the check
test.serial('check list filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['message:list:all'] })

  await checkFilters({
    t,
    endpointUrl: '/messages',
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
        prop: 'userId',
        customGetValue: (obj) => obj.receiverId || obj.senderId, // get one of the two values
        customExactValueFilterCheck: (obj, value) => [obj.receiverId, obj.senderId].includes(value)
      },
      {
        prop: 'senderId',
      },
      {
        prop: 'receiverId',
      },
      {
        prop: 'topicId',
      },
      {
        prop: 'conversationId',
      },
    ],
  })
})

test('cannot list messages if the current user does not belong to the conversation', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['message:list'],
    userId: 'usr_Y0tfQps1I3a1gJYz2I3a'
  })

  await request(t.context.serverUrl)
    .get('/messages?conversationId=conv_cbj4ks1qxT1h0sFhqxT')
    .set(authorizationHeaders)
    .expect(403)

  t.pass()
})

test('list messages with userId as filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['message:list'],
    userId: 'usr_WHlfQps1I3a1gJYz2I3a'
  })

  const { body: { results: messages } } = await request(t.context.serverUrl)
    .get('/messages?userId=usr_WHlfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  messages.forEach(message => {
    t.true([message.senderId, message.receiverId].includes('usr_WHlfQps1I3a1gJYz2I3a'))
  })
})

test('finds a message', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['message:read:all'] })

  const { body: message } = await request(t.context.serverUrl)
    .get('/messages/msg_Vuz9KRs10NK1gAHrp0NK')
    .set(authorizationHeaders)
    .expect(200)

  t.is(message.id, 'msg_Vuz9KRs10NK1gAHrp0NK')
  t.is(message.topicId, 'trn_a3BfQps1I3a1gJYz2I3a')
  t.is(message.conversationId, 'conv_4FqUqs1zln1h9gZhzln')
})

test('cannot find a message if the current user does not belong the conversation', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['message:read'],
    userId: 'usr_QVQfQps1I3a1gJYz2I3a'
  })

  await request(t.context.serverUrl)
    .get('/messages/msg_Vuz9KRs10NK1gAHrp0NK')
    .set(authorizationHeaders)
    .expect(403)

  t.pass()
})

test('creates a message', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['message:create:all'] })

  const { body: message } = await request(t.context.serverUrl)
    .post('/messages')
    .set(authorizationHeaders)
    .send({
      topicId: 'ast_2l7fQps1I3a1gJYz2I3a',
      receiverId: 'user-external-id',
      content: 'Good',
      attachments: [{ name: 'attachmentName1' }, { name: 'attachmentName2' }],
      metadata: { dummy: true }
    })
    .expect(200)

  t.truthy(message.senderId)
  t.truthy(message.conversationId)
  t.deepEqual(message.attachments, [{ name: 'attachmentName1' }, { name: 'attachmentName2' }])
  t.deepEqual(message.metadata, { dummy: true })
})

test('automatically assign a conversationId when creating a message if non provided', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['message:create:all'],
    userId: 'usr_WHlfQps1I3a1gJYz2I3a'
  })

  const { body: message1 } = await request(t.context.serverUrl)
    .post('/messages')
    .set(authorizationHeaders)
    .send({
      topicId: 'ast_2l7fQps1I3a1gJYz2I3a',
      receiverId: 'user-external-id',
      content: 'Oh yeah!',
      metadata: { dummy: true }
    })
    .expect(200)

  t.truthy(message1.conversationId)

  const { body: message2 } = await request(t.context.serverUrl)
    .post('/messages')
    .set(authorizationHeaders)
    .send({
      topicId: 'ast_2l7fQps1I3a1gJYz2I3a',
      receiverId: 'user-external-id',
      content: 'Oh yeah!',
      conversationId: 'conv_4FqUqs1zln1h9gZhzln',
      metadata: { dummy: true }
    })
    .expect(200)

  t.is(message2.conversationId, 'conv_4FqUqs1zln1h9gZhzln')
})

test('cannot create a message in a conversation if the current user does not belong to', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['message:create'],
    userId: 'user-external-id2'
  })

  await request(t.context.serverUrl)
    .post('/messages')
    .set(authorizationHeaders)
    .send({
      topicId: 'ast_2l7fQps1I3a1gJYz2I3a',
      receiverId: 'user-external-id',
      content: 'Good',
      conversationId: 'conv_4FqUqs1zln1h9gZhzln',
      metadata: { dummy: true }
    })
    .expect(403)

  t.pass()
})

test('cannot create a message with a non-existing conversationId', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['message:create:all'] })

  await request(t.context.serverUrl)
    .post('/messages')
    .set(authorizationHeaders)
    .send({
      topicId: 'ast_2l7fQps1I3a1gJYz2I3a',
      receiverId: 'user-external-id',
      content: 'Good',
      conversationId: 'conv_0HaL0s1XvY1ghqRIXvY', // non-existing conversationId
      metadata: { dummy: true }
    })
    .expect(422)

  t.pass()
})

test('updates a message', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['message:edit:all']
  })

  const { body: message } = await request(t.context.serverUrl)
    .patch('/messages/msg_Wg01MFs1Crb1gMm8pCrb')
    .set(authorizationHeaders)
    .send({
      read: true,
      metadata: {
        newThing: true
      }
    })
    .expect(200)

  t.is(message.id, 'msg_Wg01MFs1Crb1gMm8pCrb')
  t.true(message.read)
  t.true(message.metadata.newThing)
})

test('marks the message as read', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['message:edit'],
    userId: 'usr_WHlfQps1I3a1gJYz2I3a'
  })

  const { body: message } = await request(t.context.serverUrl)
    .patch('/messages/msg_Wg01MFs1Crb1gMm8pCrb')
    .set(authorizationHeaders)
    .send({
      read: true
    })
    .expect(200)

  t.is(message.id, 'msg_Wg01MFs1Crb1gMm8pCrb')
  t.true(message.read)
})

test('removes a message', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'message:read:all',
      'message:create:all',
      'message:remove:all'
    ]
  })

  const { body: message } = await request(t.context.serverUrl)
    .post('/messages')
    .set(authorizationHeaders)
    .send({
      receiverId: 'user-external-id',
      topicId: 'someTopic',
      content: 'Message to remove'
    })
    .expect(200)

  const result = await request(t.context.serverUrl)
    .delete(`/messages/${message.id}`)
    .set(authorizationHeaders)
    .expect(200)

  const payload = result.body

  t.is(payload.id, message.id)

  await request(t.context.serverUrl)
    .get(`/messages/${message.id}`)
    .set(authorizationHeaders)
    .expect(404)
})

// ////////// //
// VALIDATION //
// ////////// //

test('fails to create a message if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .post('/messages')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // missing required parameters
  result = await request(t.context.serverUrl)
    .post('/messages')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({})
    .expect(400)

  error = result.body
  t.true(error.message.includes('"topicId" is required'))
  t.true(error.message.includes('"content" is required'))
  t.true(error.message.includes('"receiverId" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .post('/messages')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      topicId: true,
      conversationId: true,
      content: true,
      attachments: true,
      read: 'invalid',
      senderId: true,
      receiverId: true,
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"topicId" must be a string'))
  t.true(error.message.includes('"conversationId" must be a string'))
  t.true(error.message.includes('"content" must be a string'))
  t.true(error.message.includes('"attachments" must be an array'))
  t.true(error.message.includes('"read" must be a boolean'))
  t.true(error.message.includes('"senderId" must be a string'))
  t.true(error.message.includes('"receiverId" must be a string'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

test('fails to update a message if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .patch('/messages/msg_GYT4WXs15RC1gFLjp5RC')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .patch('/messages/msg_GYT4WXs15RC1gFLjp5RC')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      read: 'invalid',
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"read" must be a boolean'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

// ////// //
// EVENTS //
// ////// //

// Event tests must run serially before the other tests
test.serial('generates message__* events', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'message:create:all',
      'event:list:all'
    ],
    readNamespaces: ['custom'],
    editNamespaces: ['custom']
  })

  const { body: message } = await request(t.context.serverUrl)
    .post('/messages')
    .set(authorizationHeaders)
    .send({
      topicId: 'trn_a3BfQps1I3a1gJYz2I3a',
      content: 'Some message',
      senderId: 'usr_WHlfQps1I3a1gJYz2I3a',
      receiverId: 'usr_Y0tfQps1I3a1gJYz2I3a',
      metadata: {
        test1: true,
        _custom: {
          hasDataInNamespace: true
        }
      }
    })
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 300))

  const { body: { results: events } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders)
    .expect(200)

  const messageCreatedEvent = getObjectEvent({
    events,
    eventType: 'message__created',
    objectId: message.id
  })
  await testEventMetadata({ event: messageCreatedEvent, object: message, t })
  t.is(messageCreatedEvent.object.name, message.name)
  t.is(messageCreatedEvent.object.timeBased, message.timeBased)
  t.is(messageCreatedEvent.object.metadata._custom.hasDataInNamespace, true)
})

// //////// //
// VERSIONS //
// //////// //

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('2019-05-20: list messages with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['message:list:all']
  })

  await checkOffsetPaginationScenario({
    t,
    endpointUrl: '/messages',
    authorizationHeaders,
  })
})

test('2019-05-20: list messages with id filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['message:list:all']
  })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/messages?id=msg_Vuz9KRs10NK1gAHrp0NK')
    .set(authorizationHeaders)
    .expect(200)

  checkOffsetPaginatedListObject(t, obj)
  t.is(obj.nbResults, 1)
  t.is(obj.results[0].id, 'msg_Vuz9KRs10NK1gAHrp0NK')
})

test('2019-05-20: list messages with advanced filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['message:list:all']
  })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/messages?senderId=user-external-id')
    .set(authorizationHeaders)
    .expect(200)

  const checkResultsFn = (t, message) => t.is(message.senderId, 'user-external-id')

  checkOffsetPaginatedListObject(t, obj, { checkResultsFn })
  t.is(obj.nbResults, 1)
})
