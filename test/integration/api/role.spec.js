require('dotenv').config()

const test = require('ava')
const request = require('supertest')

const { before, beforeEach, after } = require('../../lifecycle')
const { getAccessTokenHeaders } = require('../../auth')
const {
  checkCursorPaginationScenario,
  checkCursorPaginatedListObject,

  checkFilters,
} = require('../../util')

test.before(async t => {
  await before({ name: 'role' })(t)
  await beforeEach()(t)
})
// test.beforeEach(beforeEach()) // Concurrent tests are much faster
test.after(after())

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('lists roles', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['role:list:all'] })

  await checkCursorPaginationScenario({
    t,
    endpointUrl: '/roles',
    authorizationHeaders
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
        customTestValues: [true, false],
      },
    ],
  })
})

test('finds a role', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['role:read:all'] })

  const result = await request(t.context.serverUrl)
    .get('/roles/role_2tem1s1CSC1gTgJYCSC')
    .set(authorizationHeaders)
    .expect(200)

  const role = result.body

  t.is(role.id, 'role_2tem1s1CSC1gTgJYCSC')
  t.is(role.name, 'Custom')
})

test('creates a role', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['role:create:all'] })

  const result = await request(t.context.serverUrl)
    .post('/roles')
    .set(authorizationHeaders)
    .send({
      name: 'New role',
      value: 'new',
      permissions: ['category:create:all'],
      metadata: { dummy: true }
    })
    .expect(200)

  const role = result.body

  t.is(role.metadata.dummy, true)
  t.true(role.customRole)
})

test('updates a role', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['role:edit:all'] })

  const result = await request(t.context.serverUrl)
    .patch('/roles/role_2tem1s1CSC1gTgJYCSC')
    .set(authorizationHeaders)
    .send({
      permissions: ['category:create:all'],
      metadata: { dummy: true }
    })
    .expect(200)

  const role = result.body

  t.is(role.id, 'role_2tem1s1CSC1gTgJYCSC')
  t.is(role.metadata.dummy, true)
})

test('cannot update a non custom role', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['role:edit:all'] })

  await request(t.context.serverUrl)
    .patch('/roles/role_C5ZIBs105v1gHK1i05v')
    .set(authorizationHeaders)
    .send({
      permissions: ['category:create:all'],
      metadata: { dummy: true }
    })
    .expect(403)

  t.pass()
})

test('removes a role', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'role:read:all',
      'role:create:all',
      'role:remove:all'
    ]
  })

  const { body: role } = await request(t.context.serverUrl)
    .post('/roles')
    .set(authorizationHeaders)
    .send({
      name: 'Role to remove',
      value: 'role-to-remove'
    })
    .expect(200)

  const result = await request(t.context.serverUrl)
    .delete(`/roles/${role.id}`)
    .set(authorizationHeaders)
    .expect(200)

  const payload = result.body

  t.is(payload.id, role.id)

  await request(t.context.serverUrl)
    .get(`/roles/${role.id}`)
    .set(authorizationHeaders)
    .expect(404)
})

test('cannot remove a role that is still referenced by other models', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'role:read:all',
      'role:remove:all'
    ]
  })

  await request(t.context.serverUrl)
    .get('/roles/role_2tem1s1CSC1gTgJYCSC')
    .set(authorizationHeaders)
    .expect(200)

  await request(t.context.serverUrl)
    .delete('/roles/role_2tem1s1CSC1gTgJYCSC')
    .set(authorizationHeaders)
    .expect(422)

  t.pass()
})

test('cannot remove a non custom role', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['role:remove:all'] })

  await request(t.context.serverUrl)
    .delete('/roles/role_lj840s1v7v1hCM29v7v')
    .set(authorizationHeaders)
    .expect(403)

  t.pass()
})

// ////////// //
// VALIDATION //
// ////////// //

test('fails to create a role if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .post('/roles')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // missing required parameters
  result = await request(t.context.serverUrl)
    .post('/roles')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({})
    .expect(400)

  error = result.body
  t.true(error.message.includes('"name" is required'))
  t.true(error.message.includes('"value" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .post('/roles')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: true,
      parentId: true,
      permissions: true,
      readNamespaces: true,
      editNamespaces: true,
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"name" must be a string'))
  t.true(error.message.includes('"parentId" must be a string'))
  t.true(error.message.includes('"permissions" must be an array'))
  t.true(error.message.includes('"readNamespaces" must be an array'))
  t.true(error.message.includes('"editNamespaces" must be an array'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

test('fails to update a role if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .patch('/roles/role_2tem1s1CSC1gTgJYCSC')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .patch('/roles/role_2tem1s1CSC1gTgJYCSC')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: true,
      parentId: true,
      permissions: true,
      readNamespaces: true,
      editNamespaces: true,
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"name" must be a string'))
  t.true(error.message.includes('"parentId" must be a string'))
  t.true(error.message.includes('"permissions" must be an array'))
  t.true(error.message.includes('"readNamespaces" must be an array'))
  t.true(error.message.includes('"editNamespaces" must be an array'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

// //////// //
// VERSIONS //
// //////// //

test('2019-05-20: lists roles', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['role:list:all']
  })

  const result = await request(t.context.serverUrl)
    .get('/roles')
    .set(authorizationHeaders)
    .expect(200)

  const roles = result.body

  t.is(Array.isArray(roles), true)
})
