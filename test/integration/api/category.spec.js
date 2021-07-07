require('dotenv').config()

const test = require('ava')
const request = require('supertest')

const { before, beforeEach, after } = require('../../lifecycle')
const { getAccessToken, getAccessTokenHeaders, getSystemKey } = require('../../auth')
const {
  getObjectEvent,
  testEventMetadata,
  checkCursorPaginationScenario,
  checkCursorPaginatedListObject,

  checkFilters,
} = require('../../util')

test.before(async (t) => {
  await before({ name: 'category' })(t)
  await beforeEach()(t) // concurrent tests are much faster (~6 times here)
})
// test.beforeEach(beforeEach())
test.after(after())

test('gets an error if missing publishable key', async (t) => {
  const accessToken = await getAccessToken({ permissions: ['category:list:all'] })

  const { body: error } = await request(t.context.serverUrl)
    .get('/categories')
    .set({ authorization: `Bearer ${accessToken}` })
    .expect(401)

  t.is(error.message, 'Please provide a secret or publishable API key')

  const { body: error2 } = await request(t.context.serverUrl)
    .get('/categories')
    .expect(401)

  t.is(error2.message, 'Please provide a secret or publishable API key')
})

test('gets objects with livemode attribute', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['category:list:all'] })

  const { body: { results: testCategories } } = await request(t.context.serverUrl)
    .get('/categories')
    .set(authorizationHeaders)
    .expect(200)

  testCategories.forEach(cat => {
    t.false(cat.livemode)
  })

  const { body: { results: liveCategories } } = await request(t.context.serverUrl)
    .get('/categories')
    .set(Object.assign({}, authorizationHeaders, {
      'x-stelace-env': 'live'
    }))
    .expect(200)

  liveCategories.forEach(cat => {
    t.true(cat.livemode)
  })
})

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('list categories', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['category:list:all'] })

  await checkCursorPaginationScenario({
    t,
    endpointUrl: '/categories',
    authorizationHeaders
  })
})

// use serial because no changes must be made during the check
test.serial('check list filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['category:list:all'] })

  await checkFilters({
    t,
    endpointUrl: '/categories',
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
        prop: 'parentId',
        isArrayFilter: true,
      },
    ],
  })
})

test('finds an category', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['category:read:all'] })

  const result = await request(t.context.serverUrl)
    .get('/categories/ctgy_ejQQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  const category = result.body

  t.is(category.id, 'ctgy_ejQQps1I3a1gJYz2I3a')
  t.is(category.name, 'Sport')
})

test('creates an category', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['category:create:all'] })

  const result = await request(t.context.serverUrl)
    .post('/categories')
    .set(authorizationHeaders)
    .send({
      name: 'Electric',
      metadata: { dummy: true }
    })
    .expect(200)

  const category = result.body

  t.is(category.name, 'Electric')
  t.is(category.metadata.dummy, true)
})

test('creates an category with platform data', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'category:create:all',
      'platformData:edit:all'
    ],
    readNamespaces: ['custom'],
    editNamespaces: ['custom']
  })

  const result = await request(t.context.serverUrl)
    .post('/categories')
    .set(authorizationHeaders)
    .send({
      name: 'Electric',
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

  const category = result.body

  t.is(category.metadata._custom.test, true)
  t.is(category.platformData.test, true)
  t.is(category.platformData._custom.ok, true)

  await request(t.context.serverUrl)
    .post('/categories')
    .set(authorizationHeaders)
    .send({
      name: 'Electric',
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

test('cannot create a category with reserved namespaces', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['category:create:all'], editNamespaces: ['*'] })

  await request(t.context.serverUrl)
    .post('/categories')
    .set(authorizationHeaders)
    .send({
      name: 'Electric',
      metadata: {
        _private: {}
      }
    })
    .expect(403)

  await request(t.context.serverUrl)
    .post('/categories')
    .set(authorizationHeaders)
    .send({
      name: 'Electric',
      metadata: {
        _protected: {}
      }
    })
    .expect(403)

  t.pass()
})

test('cannot create a category with reserved system namespaces', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['category:create:all'], editNamespaces: ['*'] })

  await request(t.context.serverUrl)
    .post('/categories')
    .set(authorizationHeaders)
    .send({
      name: 'Electric',
      metadata: {
        _stelace: {
          test: true
        }
      }
    })
    .expect(403)

  await request(t.context.serverUrl)
    .post('/categories')
    .set(authorizationHeaders)
    .send({
      name: 'Electric',
      metadata: {
        _system: {
          test: true
        }
      }
    })
    .expect(403)

  t.pass()
})

test('can create a category with reserved system namespaces if it is the system', async (t) => {
  const systemKey = getSystemKey()

  const { body: category1 } = await request(t.context.serverUrl)
    .post('/categories')
    .set({
      'x-stelace-system-key': systemKey,
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: 'Electric',
      metadata: {
        _stelace: {
          test: true
        }
      }
    })
    .expect(200)

  t.is(category1.metadata._stelace.test, true)

  const { body: category2 } = await request(t.context.serverUrl)
    .post('/categories')
    .set({
      'x-stelace-system-key': systemKey,
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: 'Electric',
      metadata: {
        _system: {
          test: true
        }
      }
    })
    .expect(200)

  t.is(category2.metadata._system.test, true)
})

test('updates an category', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['category:edit:all'] })

  const result = await request(t.context.serverUrl)
    .patch('/categories/ctgy_N1FQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      name: 'Sport car',
      metadata: { dummy: true }
    })
    .expect(200)

  const category = result.body

  t.is(category.id, 'ctgy_N1FQps1I3a1gJYz2I3a')
  t.is(category.name, 'Sport car')
  t.is(category.metadata.dummy, true)
  t.truthy(category.metadata.metadataOnly) // merged fixture metadata
})

test('updates an category with platform data', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'category:edit:all',
      'platformData:edit:all'
    ],
    readNamespaces: ['custom'],
    editNamespaces: ['custom']
  })

  const patchPayload = {
    name: 'Electric',
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
  }

  const { body: category } = await request(t.context.serverUrl)
    .patch('/categories/ctgy_ejQQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send(patchPayload)
    .expect(200)

  t.is(category.metadata._custom.test, true)
  t.is(category.metadata.metadataOnly, 'notPlatformData') // merged fixture metadata
  t.falsy(category.metadata.platformDataOnly) // check for cross-data leaks

  t.is(category.platformData.test, true)
  t.is(category.platformData._custom.ok, true)
  t.falsy(category.platformData.metadataOnly) // check for cross-data leaks
  t.is(category.platformData.platformDataOnly, 'notMetadata') // & cross-data overwrite

  patchPayload.platformData._extra = {}

  await request(t.context.serverUrl)
    .patch('/categories/ctgy_ejQQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send(patchPayload)
    .expect(403)
})

test('cannot update an category with reserved namespaces', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['category:edit:all'], editNamespaces: ['*'] })

  await request(t.context.serverUrl)
    .patch('/categories/ctgy_ejQQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      name: 'Electric',
      metadata: {
        _private: {}
      }
    })
    .expect(403)

  await request(t.context.serverUrl)
    .patch('/categories/ctgy_ejQQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      name: 'Electric',
      metadata: {
        _protected: {}
      }
    })
    .expect(403)

  t.pass()
})

test('cannot create a circular hierarchy when updating the parent category', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['category:edit:all'] })

  await request(t.context.serverUrl)
    .patch('/categories/ctgy_WW5Qps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      parentId: 'ctgy_UVdQps1I3a1gJYz2I3a'
    })
    .expect(422)

  t.pass()
})

test('cannot update a category with reserved system namespaces', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['category:edit:all'], editNamespaces: ['*'] })

  await request(t.context.serverUrl)
    .patch('/categories/ctgy_WW5Qps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      name: 'Electric',
      metadata: {
        _stelace: {
          test: true
        }
      }
    })
    .expect(403)

  await request(t.context.serverUrl)
    .patch('/categories/ctgy_WW5Qps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      name: 'Electric',
      metadata: {
        _system: {
          test: true
        }
      }
    })
    .expect(403)

  t.pass()
})

test('can update a category with reserved system namespaces if it is the system', async (t) => {
  const systemKey = getSystemKey()

  const { body: category1 } = await request(t.context.serverUrl)
    .patch('/categories/ctgy_WW5Qps1I3a1gJYz2I3a')
    .set({
      'x-stelace-system-key': systemKey,
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: 'Electric',
      metadata: {
        _stelace: {
          test: true
        }
      }
    })
    .expect(200)

  t.is(category1.metadata._stelace.test, true)

  const { body: category2 } = await request(t.context.serverUrl)
    .patch('/categories/ctgy_WW5Qps1I3a1gJYz2I3a')
    .set({
      'x-stelace-system-key': systemKey,
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: 'Electric',
      metadata: {
        _system: {
          test: true
        }
      }
    })
    .expect(200)

  t.is(category2.metadata._system.test, true)
})

test('removes an category', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'category:read:all',
      'category:create:all',
      'category:remove:all'
    ]
  })

  const { body: category } = await request(t.context.serverUrl)
    .post('/categories')
    .set(authorizationHeaders)
    .send({
      name: 'Category to remove'
    })
    .expect(200)

  const result = await request(t.context.serverUrl)
    .delete(`/categories/${category.id}`)
    .set(authorizationHeaders)
    .expect(200)

  const payload = result.body

  t.is(payload.id, category.id)

  await request(t.context.serverUrl)
    .get(`/categories/${category.id}`)
    .set(authorizationHeaders)
    .expect(404)
})

test('cannot remove an category whose assets are still associated with', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['category:remove:all'] })

  await request(t.context.serverUrl)
    .delete('/categories/ctgy_ejQQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(422)

  t.pass()
})

test('cannot remove an category if it has children categories', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['category:remove:all'] })

  await request(t.context.serverUrl)
    .delete('/categories/ctgy_WW5Qps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(422)

  t.pass()
})

// ////////// //
// VALIDATION //
// ////////// //

test('fails to create an category if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .post('/categories')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // missing required parameters
  result = await request(t.context.serverUrl)
    .post('/categories')
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
    .post('/categories')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: true,
      parentId: true,
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"name" must be a string'))
  t.true(error.message.includes('"parentId" must be a string'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

test('fails to update an category if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .patch('/categories/ctgy_ejQQps1I3a1gJYz2I3a')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .patch('/categories/ctgy_ejQQps1I3a1gJYz2I3a')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: true,
      parentId: true,
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"name" must be a string'))
  t.true(error.message.includes('"parentId" must be a string'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

// ////// //
// EVENTS //
// ////// //

// Event tests must run serially before the other tests
test.serial('generates category__* events', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'category:create:all',
      'category:edit:all',
      'category:remove:all',
      'event:list:all'
    ],
    readNamespaces: ['custom'],
    editNamespaces: ['custom']
  })

  const { body: category } = await request(t.context.serverUrl)
    .post('/categories')
    .set(authorizationHeaders)
    .send({
      name: 'Created Event Test Asset Category',
      metadata: {
        test1: true,
        _custom: {
          hasDataInNamespace: true
        }
      }
    })
    .expect(200)

  const patchPayload = {
    name: 'Updated Event Test Asset Category, after update',
    parentId: 'ctgy_N1FQps1I3a1gJYz2I3a',
    metadata: {
      test2: true,
      _custom: {
        hasAdditionalDataInNamespace: true
      }
    }
  }

  const { body: categoryUpdated } = await request(t.context.serverUrl)
    .patch(`/categories/${category.id}`)
    .set(authorizationHeaders)
    .send(patchPayload)
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 300))

  const { body: { results: events } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders)
    .expect(200)

  const categoryCreatedEvent = getObjectEvent({
    events,
    eventType: 'category__created',
    objectId: category.id
  })
  await testEventMetadata({ event: categoryCreatedEvent, object: category, t })
  t.is(categoryCreatedEvent.object.name, category.name)
  t.is(categoryCreatedEvent.object.metadata._custom.hasDataInNamespace, true)
  t.not(categoryCreatedEvent.object.metadata._custom.hasAdditionalDataInNamespace, true)

  const categoryUpdatedEvent = getObjectEvent({
    events,
    eventType: 'category__updated',
    objectId: categoryUpdated.id
  })
  await testEventMetadata({
    event: categoryUpdatedEvent,
    object: categoryUpdated,
    t,
    patchPayload
  })
  t.is(categoryUpdatedEvent.object.name, categoryUpdated.name)
  t.is(categoryUpdatedEvent.object.metadata._custom.hasDataInNamespace, true)
  t.is(categoryUpdatedEvent.object.metadata._custom.hasAdditionalDataInNamespace, true)

  await request(t.context.serverUrl)
    .delete(`/categories/${categoryUpdated.id}`)
    .set(authorizationHeaders)
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 300))

  const { body: { results: eventsAfterDelete } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders)
    .expect(200)

  const categoryDeletedEvent = getObjectEvent({
    events: eventsAfterDelete,
    eventType: 'category__deleted',
    objectId: categoryUpdated.id
  })
  await testEventMetadata({ event: categoryDeletedEvent, object: categoryUpdated, t })
})

// //////// //
// VERSIONS //
// //////// //

test('2019-05-20: gets objects with livemode attribute', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['category:list:all']
  })

  const { body: testCategories } = await request(t.context.serverUrl)
    .get('/categories')
    .set(authorizationHeaders)
    .expect(200)

  testCategories.forEach(cat => {
    t.false(cat.livemode)
  })

  const { body: liveCategories } = await request(t.context.serverUrl)
    .get('/categories')
    .set(Object.assign({}, authorizationHeaders, {
      'x-stelace-env': 'live'
    }))
    .expect(200)

  liveCategories.forEach(cat => {
    t.true(cat.livemode)
  })
})

test('2019-05-20: list asset categories', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['category:list:all']
  })

  const result = await request(t.context.serverUrl)
    .get('/categories')
    .set(authorizationHeaders)
    .expect(200)

  const categories = result.body

  t.true(Array.isArray(categories))
})
