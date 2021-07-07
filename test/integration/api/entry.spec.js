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
  await before({ name: 'entry' })(t)
  await beforeEach()(t)
})
// test.beforeEach(beforeEach()) // Concurrent tests are much faster
test.after(after())

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('list entries with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['entry:list:all'] })

  await checkCursorPaginationScenario({
    t,
    endpointUrl: '/entries',
    authorizationHeaders,
  })
})

test('list entries with id filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['entry:list:all'] })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/entries?id=ent_4KquHhs1WeG1hK71uWeG')
    .set(authorizationHeaders)
    .expect(200)

  checkCursorPaginatedListObject(t, obj)
  t.is(obj.results.length, 1)
})

test('list entries with advanced filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['entry:list:all'] })

  const { body: obj1 } = await request(t.context.serverUrl)
    .get('/entries?collection=website,email')
    .set(authorizationHeaders)
    .expect(200)

  obj1.results.forEach(entry => {
    t.true(['website', 'email'].includes(entry.collection))
  })

  const { body: obj2 } = await request(t.context.serverUrl)
    .get('/entries?collection=website,email&locale=en-US,zh-Hans-CN')
    .set(authorizationHeaders)
    .expect(200)

  obj2.results.forEach(entry => {
    t.true(['website', 'email'].includes(entry.collection))
    t.true(['en-US', 'zh-Hans-CN'].includes(entry.locale))
    t.is(entry.locale, 'en-US')
  })

  const { body: obj3 } = await request(t.context.serverUrl)
    .get('/entries?collection=website,email&name=home,signup')
    .set(authorizationHeaders)
    .expect(200)

  obj3.results.forEach(entry => {
    t.true(['website', 'email'].includes(entry.collection))
    t.true(['home', 'signup'].includes(entry.name))
  })
})

// use serial because no changes must be made during the check
test.serial('check list filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['asset:list:all'] })

  await checkFilters({
    t,
    endpointUrl: '/entries',
    authorizationHeaders,
    checkPaginationObject: checkCursorPaginatedListObject,

    filters: [
      {
        prop: 'id',
        isArrayFilter: true,
      },
      {
        prop: 'collection',
        isArrayFilter: true,
      },
      {
        prop: 'locale',
        isArrayFilter: true,
      },
      {
        prop: 'name',
        isArrayFilter: true,
      },
    ],
  })
})

test('finds an entry', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['entry:read:all'] })

  const { body: entry } = await request(t.context.serverUrl)
    .get('/entries/ent_4KquHhs1WeG1hK71uWeG')
    .set(authorizationHeaders)
    .expect(200)

  t.is(entry.id, 'ent_4KquHhs1WeG1hK71uWeG')
})

test('creates an entry', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['entry:create:all'] })

  const fields = {
    title: 'Random title',
    content: 'Random content',
    nestedContent: {
      random1: {
        random2: 'hello'
      },
      random3: 'bye'
    }
  }

  const { body: entry } = await request(t.context.serverUrl)
    .post('/entries')
    .set(authorizationHeaders)
    .send({
      collection: 'collectionExample',
      locale: 'fr-FR',
      name: 'nameExample',
      fields,
      metadata: {
        metadataField: true
      }
    })
    .expect(200)

  t.is(entry.collection, 'collectionExample')
  t.is(entry.locale, 'fr-FR')
  t.is(entry.name, 'nameExample')
  t.deepEqual(entry.fields, fields)
  t.deepEqual(entry.metadata, { metadataField: true })
})

test('creates an entry with a long locale', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['entry:create:all'] })

  const fields = {
    title: 'Random title',
    content: 'Random content',
    nestedContent: {
      random1: {
        random2: 'hello'
      },
      random3: 'bye'
    }
  }

  const { body: entry } = await request(t.context.serverUrl)
    .post('/entries')
    .set(authorizationHeaders)
    .send({
      collection: 'collectionExample',
      locale: 'zh-Hans-CN',
      name: 'nameExample',
      fields,
      metadata: {
        metadataField: true
      }
    })
    .expect(200)

  t.is(entry.collection, 'collectionExample')
  t.is(entry.locale, 'zh-Hans-CN')
  t.is(entry.name, 'nameExample')
  t.deepEqual(entry.fields, fields)
  t.deepEqual(entry.metadata, { metadataField: true })
})

test('fails to create a duplicated entry', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['entry:create:all'] })

  const fields = {
    title: 'Random title',
    content: 'Random content',
    nestedContent: {
      random1: {
        random2: 'hello'
      },
      random3: 'bye'
    }
  }

  const payload = {
    collection: 'duplicatedCollection',
    locale: 'en',
    name: 'duplicatedName',
    fields,
    metadata: {
      metadataField: true
    }
  }

  const { body: entry } = await request(t.context.serverUrl)
    .post('/entries')
    .set(authorizationHeaders)
    .send(payload)
    .expect(200)

  t.is(entry.collection, 'duplicatedCollection')
  t.is(entry.locale, 'en')
  t.is(entry.name, 'duplicatedName')
  t.deepEqual(entry.fields, fields)
  t.deepEqual(entry.metadata, { metadataField: true })

  const { body: error } = await request(t.context.serverUrl)
    .post('/entries')
    .set(authorizationHeaders)
    .send(payload)
    .expect(422)

  t.true(error.message.includes(entry.id))
  t.true(error.message.includes('same name and locale'))

  const { body: error2 } = await request(t.context.serverUrl)
    .post('/entries')
    .set(authorizationHeaders)
    .send(Object.assign({}, payload, { collection: 'anotherCollection' }))
    .expect(422)

  t.true(error2.message.includes(entry.id))
  t.true(error2.message.includes('same name and locale'))
})

test('updates an entry', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['entry:edit:all'] })

  const newNestedContent = {
    test: 'test'
  }

  const { body: entry } = await request(t.context.serverUrl)
    .patch('/entries/ent_4KquHhs1WeG1hK71uWeG')
    .set(authorizationHeaders)
    .send({
      collection: 'random',
      fields: {
        newField: true,
        nestedContent: newNestedContent
      },
      metadata: {
        dummy: true
      }
    })
    .expect(200)

  t.is(entry.id, 'ent_4KquHhs1WeG1hK71uWeG')
  t.is(entry.fields.newField, true)
  t.deepEqual(entry.fields.nestedContent, newNestedContent)
  t.true(Object.keys(entry.fields).length > 1)
  t.is(entry.collection, 'random')
  t.true(entry.metadata.dummy)
})

test('fails to update a duplicated entry', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'entry:create:all',
      'entry:edit:all'
    ]
  })

  const fields = {
    title: 'Random title',
    content: 'Random content',
    nestedContent: {
      random1: {
        random2: 'hello'
      },
      random3: 'bye'
    }
  }

  const payload = {
    collection: 'duplicatedCollectionForUpdate',
    locale: 'en',
    name: 'duplicatedNameForUpdate',
    fields,
    metadata: {
      metadataField: true
    }
  }

  const { body: entry } = await request(t.context.serverUrl)
    .post('/entries')
    .set(authorizationHeaders)
    .send(payload)
    .expect(200)

  t.is(entry.collection, 'duplicatedCollectionForUpdate')
  t.is(entry.locale, 'en')
  t.is(entry.name, 'duplicatedNameForUpdate')
  t.deepEqual(entry.fields, fields)
  t.deepEqual(entry.metadata, { metadataField: true })

  const { body: entry2 } = await request(t.context.serverUrl)
    .post('/entries')
    .set(authorizationHeaders)
    .send(Object.assign({}, payload, { locale: 'fr' })) // only locale is different
    .expect(200)

  const { body: error } = await request(t.context.serverUrl)
    .patch(`/entries/${entry2.id}`)
    .set(authorizationHeaders)
    .send({ locale: payload.locale })
    .expect(422)

  t.true(error.message.includes(entry.id))
  t.true(error.message.includes('same name and locale'))

  const { body: error2 } = await request(t.context.serverUrl)
    .patch(`/entries/${entry2.id}`)
    .set(authorizationHeaders)
    .send(Object.assign({}, payload, { locale: payload.locale, collection: 'anotherCollection' }))
    .expect(422)

  t.true(error2.message.includes(entry.id))
  t.true(error2.message.includes('same name and locale'))
})

test('removes an entry', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'entry:read:all',
      'entry:remove:all'
    ]
  })

  await request(t.context.serverUrl)
    .get('/entries/ent_4KquHhs1WeG1hK71uWeG')
    .set(authorizationHeaders)
    .expect(200)

  const result = await request(t.context.serverUrl)
    .delete('/entries/ent_4KquHhs1WeG1hK71uWeG')
    .set(authorizationHeaders)
    .expect(200)

  const payload = result.body

  t.is(payload.id, 'ent_4KquHhs1WeG1hK71uWeG')

  await request(t.context.serverUrl)
    .get('/entries/ent_4KquHhs1WeG1hK71uWeG')
    .set(authorizationHeaders)
    .expect(404)
})

// ////////// //
// VALIDATION //
// ////////// //

test('fails to create a document if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .post('/entries')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // missing required parameters
  result = await request(t.context.serverUrl)
    .post('/entries')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({})
    .expect(400)

  error = result.body
  t.true(error.message.includes('"collection" is required'))
  t.true(error.message.includes('"locale" is required'))
  t.true(error.message.includes('"name" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .post('/entries')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      collection: true,
      locale: true,
      name: true,
      fields: true,
      metadata: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"collection" must be a string'))
  t.true(error.message.includes('"locale" must be a string'))
  t.true(error.message.includes('"name" must be a string'))
  t.true(error.message.includes('"fields" must be of type object'))
  t.true(error.message.includes('"metadata" must be of type object'))
})

test('fails to update a document if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .patch('/entries/ent_4KquHhs1WeG1hK71uWeG')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .patch('/entries/ent_4KquHhs1WeG1hK71uWeG')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      collection: true,
      name: true,
      fields: true,
      metadata: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"collection" must be a string'))
  t.true(error.message.includes('"name" must be a string'))
  t.true(error.message.includes('"fields" must be of type object'))
  t.true(error.message.includes('"metadata" must be of type object'))
})

// ////// //
// EVENTS //
// ////// //

// Event tests must run serially before the other tests
test.serial('generates entry__* events', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'entry:create:all',
      'entry:edit:all',
      'entry:remove:all',
      'event:list:all'
    ],
    readNamespaces: ['*'],
    editNamespaces: ['*']
  })

  const { body: entry } = await request(t.context.serverUrl)
    .post('/entries')
    .set(authorizationHeaders)
    .send({
      collection: 'test',
      locale: 'fr',
      name: 'home',
      fields: {
        test: 'test'
      },
      metadata: {
        dummy: false
      }
    })
    .expect(200)

  const patchPayload = {
    fields: {
      content: 'test content'
    },
    metadata: {
      dummy: true
    }
  }

  const { body: entryUpdated } = await request(t.context.serverUrl)
    .patch(`/entries/${entry.id}`)
    .set(authorizationHeaders)
    .send(patchPayload)
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 300))

  const { body: { results: events } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders)
    .expect(200)

  const entryCreatedEvent = getObjectEvent({
    events,
    eventType: 'entry__created',
    objectId: entry.id
  })
  await testEventMetadata({ event: entryCreatedEvent, object: entry, t })
  t.is(entryCreatedEvent.object.collection, entry.collection)
  t.is(entryCreatedEvent.object.locale, entry.locale)
  t.is(entryCreatedEvent.object.name, entry.name)
  t.is(entryCreatedEvent.object.fields.test, entry.fields.test)
  t.is(entryCreatedEvent.object.metadata.dummy, false)

  const entryUpdatedEvent = getObjectEvent({
    events,
    eventType: 'entry__updated',
    objectId: entryUpdated.id
  })
  await testEventMetadata({
    event: entryUpdatedEvent,
    object: entryUpdated,
    t,
    patchPayload
  })
  t.is(entryUpdatedEvent.object.fields.content, entryUpdated.fields.content)
  t.is(entryUpdatedEvent.object.metadata.dummy, true)

  await request(t.context.serverUrl)
    .delete(`/entries/${entryUpdated.id}`)
    .set(authorizationHeaders)
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 300))

  const { body: { results: eventsAfterDelete } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders)
    .expect(200)

  const entryDeletedEvent = getObjectEvent({
    events: eventsAfterDelete,
    eventType: 'entry__deleted',
    objectId: entryUpdated.id
  })
  await testEventMetadata({ event: entryDeletedEvent, object: entryUpdated, t })
})

// //////// //
// VERSIONS //
// //////// //

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('2019-05-20: list entries with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['entry:list:all']
  })

  await checkOffsetPaginationScenario({
    t,
    endpointUrl: '/entries',
    authorizationHeaders,
  })
})

test('2019-05-20: list entries with id filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['entry:list:all']
  })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/entries?id=ent_4KquHhs1WeG1hK71uWeG')
    .set(authorizationHeaders)
    .expect(200)

  checkOffsetPaginatedListObject(t, obj)
  t.is(obj.nbResults, 1)
})
