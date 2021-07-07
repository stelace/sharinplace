require('dotenv').config()

const test = require('ava')
const request = require('supertest')
const _ = require('lodash')
const bluebird = require('bluebird')

const { before, beforeEach, after } = require('../../lifecycle')
const { getAccessTokenHeaders, defaultUserId } = require('../../auth')
const {
  getObjectEvent,
  testEventMetadata,

  checkOffsetPaginationScenario,
  checkOffsetPaginatedListObject,

  checkCursorPaginationScenario,
  checkCursorPaginatedListObject,

  checkFilters,
} = require('../../util')

const { encodeBase64 } = require('../../../src/util/encoding')

test.before(async t => {
  await before({ name: 'user' })(t)
  await beforeEach()(t)
})
// test.beforeEach(beforeEach()) // Concurrent tests are much faster
test.after(after())

test('checks if the username is available', async (t) => {
  // `user:list:all` permission is public by default
  const result1 = await request(t.context.serverUrl)
    .get('/users/check-availability?username=admin')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(200)

  const { available } = result1.body

  t.false(available)

  const result2 = await request(t.context.serverUrl)
    .get('/users/check-availability?username=noone')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(200)

  const { available: available2 } = result2.body

  t.true(available2)
})

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('list users with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['user:list:all'] })

  await checkCursorPaginationScenario({
    t,
    endpointUrl: '/users',
    authorizationHeaders,
  })
})

test('list users with id filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['user:list:all'] })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/users?id=usr_WHlfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  checkCursorPaginatedListObject(t, obj)
  t.is(obj.results.length, 1)
})

// use serial because no changes must be made during the check
test.serial('check list filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['user:list:all'] })

  await checkFilters({
    t,
    endpointUrl: '/users',
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
      // `query`, `type` and `userOrganizationId` tested in other tests
    ],
  })
})

test('list users with query filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['user:list:all'] })

  const query = 'user2'

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/users?query=${query}`)
    .set(authorizationHeaders)
    .expect(200)

  checkCursorPaginatedListObject(t, obj)
  t.is(obj.results.length, 1)

  obj.results.forEach(user => {
    const fields = [
      'displayName',
      'firstname',
      'lastname',
      'username',
      'email'
    ]

    const matchQuery = fields.some(field => {
      return user[field] && user[field].toLowerCase().replace(/\s/gi, '').includes(query)
    })

    t.true(matchQuery)
  })
})

test('list users without type should only return natural users', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['user:list:all'] })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/users')
    .set(authorizationHeaders)
    .expect(200)

  const checkResultsFn = (t, user) => t.true(!user.roles.includes('organization'))
  checkCursorPaginatedListObject(t, obj, { checkResultsFn })
})

test('list organization users', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['user:list:all'] })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/users?type=organization')
    .set(authorizationHeaders)
    .expect(200)

  const checkResultsFn = (t, user) => t.true(user.roles.includes('organization'))
  checkCursorPaginatedListObject(t, obj, { checkResultsFn })
})

test('list users and organizations', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['user:list:all'] })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/users?type=all')
    .set(authorizationHeaders)
    .expect(200)

  let hasUsers = false
  let hasOrganizations = false

  const checkResultsFn = (t, user) => {
    const isOrg = user.roles.includes('organization')

    hasUsers = hasUsers || !isOrg
    hasOrganizations = hasOrganizations || isOrg
  }
  checkCursorPaginatedListObject(t, obj, { checkResultsFn })

  t.true(hasUsers)
  t.true(hasOrganizations)
})

test('list users and organizations filtering by IDs without providing type', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['user:list:all'] })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/users?id[]=usr_WHlfQps1I3a1gJYz2I3a&id[]=org_xC3ZlGs1Jo71gb2G0Jo7')
    .set(authorizationHeaders)
    .expect(200)

  const checkResultsFn = (t, user) => {
    t.true(['usr_WHlfQps1I3a1gJYz2I3a', 'org_xC3ZlGs1Jo71gb2G0Jo7'].includes(user.id))
  }
  checkCursorPaginatedListObject(t, obj, { checkResultsFn })
})

test('list members of an organization using userOrganizationId filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['user:list:all'] })

  const orgId = 'org_yiBSnhs1zaP1hh8rczaP'
  const { body: obj } = await request(t.context.serverUrl)
    .get(`/users?userOrganizationId=${orgId}`)
    .set(authorizationHeaders)
    .expect(200)

  const checkResultsFn = (t, user) => t.true(Object.keys(user.organizations).includes(orgId))
  checkCursorPaginatedListObject(t, obj, { checkResultsFn })
  t.is(obj.results.length, 3)
})

test('list user belonging to every listed using userOrganizationId filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['user:list:all'] })

  const orgIds = ['org_xC3ZlGs1Jo71gb2G0Jo7', 'org_yiBSnhs1zaP1hh8rczaP']
  const { body: obj } = await request(t.context.serverUrl)
    .get(`/users?userOrganizationId=${orgIds.join(',')}`)
    .set(authorizationHeaders)
    .expect(200)

  const checkResultsFn = (t, user) => {
    t.true(orgIds.every(id => Object.keys(user.organizations).includes(id)))
  }
  checkCursorPaginatedListObject(t, obj, { checkResultsFn })
  t.is(obj.results.length, 1)
})

test('finds a user', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['user:read:all'] })

  const result = await request(t.context.serverUrl)
    .get('/users/usr_WHlfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  const user = result.body

  t.is(user.id, 'usr_WHlfQps1I3a1gJYz2I3a')
  t.falsy(user.username)
})

test('finds own user (display private and protected namespace)', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['user:read:all'], userId: 'usr_QVQfQps1I3a1gJYz2I3a' })

  const result = await request(t.context.serverUrl)
    .get('/users/usr_QVQfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  const user = result.body

  t.is(user.id, 'usr_QVQfQps1I3a1gJYz2I3a')
  t.truthy(user.username)
  t.truthy(user.firstname)
  t.truthy(user.lastname)
  t.truthy(user.email)
  t.truthy(user.metadata._private)
  t.truthy(user.metadata._protected)
  t.truthy(user.platformData._private)
  t.truthy(user.platformData._protected)
})

test('finds a user from a transaction (display protected namespace)', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['user:read:all'], userId: 'usr_Y0tfQps1I3a1gJYz2I3a' })

  const result = await request(t.context.serverUrl)
    .get('/users/usr_QVQfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  const user = result.body

  t.is(user.id, 'usr_QVQfQps1I3a1gJYz2I3a')
  t.falsy(user.username)
  t.falsy(user.firstname)
  t.falsy(user.lastname)
  t.falsy(user.email)
  t.falsy(user.metadata._private)
  t.truthy(user.metadata._protected)
  t.falsy(user.platformData._private)
  t.truthy(user.platformData._protected)
})

test('finds a user with no relation (display neither private nor protected namespace)', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['user:read:all'], userId: '43b7c248-4cca-43ff-95b6-f44a088e2ef2' })

  const result = await request(t.context.serverUrl)
    .get('/users/usr_QVQfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  const user = result.body

  t.is(user.id, 'usr_QVQfQps1I3a1gJYz2I3a')
  t.falsy(user.username)
  t.falsy(user.firstname)
  t.falsy(user.lastname)
  t.falsy(user.email)
  t.falsy(user.metadata._private)
  t.falsy(user.metadata._protected)
  t.falsy(user.platformData._private)
  t.falsy(user.platformData._protected)
})

test('creates a user', async (t) => {
  const result = await request(t.context.serverUrl)
    .post('/users')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      username: _.uniqueId('randomUser'),
      password: _.uniqueId('randomPassword'),
      metadata: {
        _private: {
          firstname: 'Random',
          lastname: 'RANDOM'
        },
        dummy: true
      }
    })
    .expect(200)

  const user = result.body

  t.is(user.metadata.dummy, true)
  t.truthy(user.username)
  t.is(user.metadata._private.firstname, 'Random')
})

test('cannot use a existing username to create a user', async (t) => {
  await request(t.context.serverUrl)
    .post('/users')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      username: 'admin',
      password: 'adminPassword',
      metadata: { dummy: true }
    })
    .expect(422)

  t.pass()
})

test('creates a user with roles if the config permission is provided', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'user:create:all',
      'user:config:all'
    ],
    readNamespaces: ['private'] // need the private namespace to read the username
  })

  const result = await request(t.context.serverUrl)
    .post('/users')
    .set(authorizationHeaders)
    .send({
      username: _.uniqueId('randomUser'),
      password: _.uniqueId('randomPassword'),
      roles: ['dev']
    })
    .expect(200)

  const user = result.body

  t.truthy(user.username)
  t.deepEqual(user.roles, ['dev'])
})

test('creates a user with roles if the roles are in whitelist', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['config:edit:all'] })

  await request(t.context.serverUrl)
    .patch('/config')
    .set(authorizationHeaders)
    .send({
      stelace: {
        roles: {
          default: ['provider']
        }
      }
    })

  const username = _.uniqueId('randomUser')
  const password = _.uniqueId('randomPassword')

  const { body: user } = await request(t.context.serverUrl)
    .post('/users')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      username,
      password,
      roles: ['provider']
    })
    .expect(200)

  t.deepEqual(user.roles, ['provider'])

  await request(t.context.serverUrl)
    .post('/users')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      username,
      password,
      roles: ['custom']
    })
    .expect(422)
})

test('creates a user with the config default roles', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['config:edit:all'] })

  await request(t.context.serverUrl)
    .patch('/config')
    .set(authorizationHeaders)
    .send({
      stelace: {
        roles: {
          default: ['provider']
        }
      }
    })

  const { body: user } = await request(t.context.serverUrl)
    .post('/users')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      username: _.uniqueId('randomUser'),
      password: _.uniqueId('randomPassword'),
    })
    .expect(200)

  t.deepEqual(user.roles, ['provider'])
})

test('cannot create a user with roles if missing config permission', async (t) => {
  await request(t.context.serverUrl)
    .post('/users')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      username: _.uniqueId('randomUser'),
      password: _.uniqueId('randomPassword'),
      roles: ['dev']
    })
    .expect(403)

  t.pass()
})

test('cannot create a user with an unknown role', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'user:create:all',
      'user:config:all'
    ]
  })

  await request(t.context.serverUrl)
    .post('/users')
    .set(authorizationHeaders)
    .send({
      username: _.uniqueId('randomUser'),
      password: _.uniqueId('randomPassword'),
      roles: ['unknown']
    })
    .expect(422)

  t.pass()
})

test('creates an organization', async (t) => {
  const userId = 'usr_QVQfQps1I3a1gJYz2I3a'

  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'organization:create',
      'user:read:all'
    ],
    userId
  })

  const { body: organization } = await request(t.context.serverUrl)
    .post('/users')
    .set(authorizationHeaders)
    .send({
      type: 'organization',
      metadata: {
        dummy: true
      }
    })
    .expect(200)

  t.is(organization.metadata.dummy, true)

  // check that the current user has been automatically associated to the organization
  const { body: user } = await request(t.context.serverUrl)
    .get(`/users/${userId}`)
    .set(authorizationHeaders)
    .expect(200)

  t.truthy(user.organizations[organization.id])
  t.true(Array.isArray(user.organizations[organization.id].roles))
})

test('creates an organization with orgOwnerId parameter', async (t) => {
  const userId = 'usr_QVQfQps1I3a1gJYz2I3a'

  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'organization:create:all',
      'user:read:all'
    ],
    userId
  })

  const { body: organization } = await request(t.context.serverUrl)
    .post('/users')
    .set(authorizationHeaders)
    .send({
      type: 'organization',
      orgOwnerId: userId,
      metadata: {
        dummy: true
      }
    })
    .expect(200)

  t.is(organization.metadata.dummy, true)
  t.is(organization.orgOwnerId, userId)

  // check that the targeted user has been automatically associated with the organization
  const { body: user } = await request(t.context.serverUrl)
    .get(`/users/${userId}`)
    .set(authorizationHeaders)
    .expect(200)

  t.truthy(user.organizations[organization.id])
  t.deepEqual(user.organizations[organization.id].roles, ['dev'])
  t.falsy(user.orgOwnerId) // only exposed on organization users
})

test('cannot create an organization with username and password', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'organization:create'
    ]
  })

  await request(t.context.serverUrl)
    .post('/users')
    .set(authorizationHeaders)
    .send({
      type: 'organization',
      username: 'random1',
      password: 'secretPassword'
    })
    .expect(400)

  t.pass()
})

test('creates a child organization', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'organization:create'
    ],
    userId: 'usr_WHlfQps1I3a1gJYz2I3a'
  })

  const { body: organization } = await request(t.context.serverUrl)
    .post('/users')
    .set(Object.assign({}, authorizationHeaders, {
      'x-stelace-organization-id': 'org_xC3ZlGs1Jo71gb2G0Jo7'
    }))
    .send({
      type: 'organization',
      organizations: {
        org_xC3ZlGs1Jo71gb2G0Jo7: {}
      }
    })
    .expect(200)

  t.truthy(organization.organizations.org_xC3ZlGs1Jo71gb2G0Jo7)
})

test('cannot create a child organization if the current user does not belong to the parent one', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'organization:create'
    ]
  })

  await request(t.context.serverUrl)
    .post('/users')
    .set(Object.assign({}, authorizationHeaders, {
      'x-stelace-organization-id': 'org_xC3ZlGs1Jo71gb2G0Jo7'
    }))
    .send({
      type: 'organization',
      organizations: {
        org_toMLWis1EpB1gwNcfEpB: {}
      }
    })
    .expect(403)

  t.pass()
})

test('cannot create a child organization if providing an invalid parent organization', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'organization:create'
    ]
  })

  const parentOrgId = 'usr_T2VfQps1I3a1gJYz2I3a'

  const { body: error } = await request(t.context.serverUrl)
    .post('/users')
    .set(Object.assign({}, authorizationHeaders, {
      'x-stelace-organization-id': parentOrgId
    }))
    .send({
      type: 'organization',
      organizations: {
        usr_T2VfQps1I3a1gJYz2I3a: {}
      }
    })
    .expect(403)

  t.regex(error.message, /exist/i)
  t.is(error.data.organizationId, parentOrgId)
})

test('cannot update a child organization rights in parent org or join other organizations', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'user:configOrganization:all'
    ]
  })

  const parentOrgId = 'org_toMLWis1EpB1gwNcfEpB'
  const childOrgId = 'org_b2uQEos1lDa1hSm2XlDa'

  const { body: error } = await request(t.context.serverUrl)
    .put(`/users/${childOrgId}/organizations/${parentOrgId}`)
    .set(Object.assign({}, authorizationHeaders, {
      'x-stelace-organization-id': childOrgId
    }))
    .send({ roles: ['user'] })
    .expect(403)

  t.regex(error.message, /child/i)
  t.is(error.data.parentOrganizationId, parentOrgId)

  const newParentOrgId = 'org_xC3ZlGs1Jo71gb2G0Jo7'

  const { body: error2 } = await request(t.context.serverUrl)
    .put(`/users/${childOrgId}/organizations/${newParentOrgId}`)
    .set(authorizationHeaders)
    .send({ roles: ['user'] })
    .expect(403)

  t.regex(error2.message, /child/i)
  t.is(error2.data.parentOrganizationId, parentOrgId)
})

test('creates an organization if the user belongs to an ancestor organization', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'organization:create'
    ]
  })

  const { body: organization } = await request(t.context.serverUrl)
    .post('/users')
    .set(Object.assign({}, authorizationHeaders, {
      'x-stelace-organization-id': 'org_toMLWis1EpB1gwNcfEpB'
    }))
    .send({
      type: 'organization',
      organizations: {
        // creating a child of this org (and grand-child of org_toMLWis1EpB1gwNcfEpB)
        org_yiBSnhs1zaP1hh8rczaP: {}
      }
    })
    .expect(200)

  t.truthy(organization.organizations.org_yiBSnhs1zaP1hh8rczaP)
  t.is(organization.orgOwnerId, defaultUserId) /// used in authorizationHeaders
})

test('cannot create an organization that references a parent organization if the user belongs only to the child organization', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'organization:create'
    ],
    userId: 'usr_Y0tfQps1I3a1gJYz2I3a'
  })

  await request(t.context.serverUrl)
    .post('/users')
    .set(Object.assign({}, authorizationHeaders, {
      'x-stelace-organization-id': 'org_yiBSnhs1zaP1hh8rczaP'
    }))
    .send({
      type: 'organization',
      organizations: {
        org_toMLWis1EpB1gwNcfEpB: {}
      }
    })
    .expect(403)

  t.pass()
})

test('cannot create an organization with the permission "user:create"', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'user:create'
    ]
  })

  await request(t.context.serverUrl)
    .post('/users')
    .set(authorizationHeaders)
    .send({
      type: 'organization',
      organizations: {
        org_toMLWis1EpB1gwNcfEpB: {}
      }
    })
    .expect(403)

  t.pass()
})

test('cannot create a user with the permission "organization:create"', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'organization:create'
    ]
  })

  await request(t.context.serverUrl)
    .post('/users')
    .set(authorizationHeaders)
    .send({
      username: 'random1',
      password: 'secretPassword'
    })
    .expect(403)

  t.pass()
})

test('updates a user', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['user:edit:all'] })

  const result = await request(t.context.serverUrl)
    .patch('/users/usr_WHlfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      metadata: { dummy: true }
    })
    .expect(200)

  const user = result.body

  t.is(user.id, 'usr_WHlfQps1I3a1gJYz2I3a')
  t.falsy(user.username)
  t.is(user.metadata.dummy, true)
})

test('update own private namespace', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['user:edit:all'], userId: 'usr_WHlfQps1I3a1gJYz2I3a' })

  const result = await request(t.context.serverUrl)
    .patch('/users/usr_WHlfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      metadata: {
        _private: {
          firstname: 'Random',
          lastname: 'RANDOM'
        },
        dummy: true
      }
    })
    .expect(200)

  const user = result.body

  t.is(user.id, 'usr_WHlfQps1I3a1gJYz2I3a')
  t.truthy(user.username)
  t.is(user.metadata._private.firstname, 'Random')
  t.is(user.metadata.dummy, true)
})

test('cannot update the private namespace for another user', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['user:edit:all'] })

  await request(t.context.serverUrl)
    .patch('/users/usr_WHlfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      metadata: {
        _private: {
          firstname: 'Random',
          lastname: 'RANDOM'
        },
        dummy: true
      }
    })
    .expect(403)

  t.pass()
})

test('updates a user with new roles if the "user:config:all" permission is provided', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'user:edit:all',
      'user:config:all'
    ],
    readNamespaces: ['private'] // need the private namespace to read the username
  })

  const result = await request(t.context.serverUrl)
    .patch('/users/usr_WHlfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      roles: ['dev']
    })
    .expect(200)

  const user = result.body

  t.truthy(user.username)
  t.deepEqual(user.roles, ['dev'])
})

test('cannot update a user with new roles if "user:config:all" permission is missing', async (t) => {
  await request(t.context.serverUrl)
    .patch('/users/usr_WHlfQps1I3a1gJYz2I3a')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      roles: ['dev']
    })
    .expect(403)

  t.pass()
})

test('cannot update a user with an unknown role', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'user:edit:all',
      'user:config:all'
    ]
  })

  await request(t.context.serverUrl)
    .patch('/users/usr_WHlfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      roles: ['unknown']
    })
    .expect(422)

  t.pass()
})

test('updates a user username', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['user:edit:all'],
    userId: 'usr_T2VfQps1I3a1gJYz2I3a'
  })

  const newUsername = _.uniqueId('newUsername')

  const { body: updatedUser } = await request(t.context.serverUrl)
    .patch('/users/usr_T2VfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      username: newUsername
    })
    .expect(200)

  t.is(updatedUser.username, newUsername)
})

test('updates an organization if the user is a member', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'user:edit'
    ],
    userId: 'usr_WHlfQps1I3a1gJYz2I3a'
  })

  const { body: organization } = await request(t.context.serverUrl)
    .patch('/users/org_xC3ZlGs1Jo71gb2G0Jo7')
    .set(Object.assign({}, authorizationHeaders, {
      'x-stelace-organization-id': 'org_xC3ZlGs1Jo71gb2G0Jo7'
    }))
    .send({
      firstname: 'Firstname',
      lastname: 'Lastname'
    })
    .expect(200)

  t.is(organization.id, 'org_xC3ZlGs1Jo71gb2G0Jo7')
  t.is(organization.firstname, 'Firstname')
  t.is(organization.lastname, 'Lastname')
})

test('transfers organization ownership as an owner', async (t) => {
  const userId = 'usr_WHlfQps1I3a1gJYz2I3a'
  const newOwnerId = 'usr_Y0tfQps1I3a1gJYz2I3a'
  const organizationId = 'org_xC3ZlGs1Jo71gb2G0Jo7'
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'user:read:all',
      'user:edit'
    ],
    userId
  })

  const { body: firstOwnerBeforeTransfers } = await request(t.context.serverUrl)
    .get(`/users/${userId}`)
    .set(authorizationHeaders)
    .expect(200)

  // Current owner is always expected to have dev rights by default
  // but we assume it was removed for this test
  const firstOwnerRolesBeforeTransfers = firstOwnerBeforeTransfers.organizations[organizationId].roles
  t.false(Object.keys(firstOwnerRolesBeforeTransfers).includes('dev'))

  const { body: secondOwnerBeforeTransfers } = await request(t.context.serverUrl)
    .get(`/users/${newOwnerId}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(secondOwnerBeforeTransfers.organizations[organizationId], undefined)

  const { body: organization } = await request(t.context.serverUrl)
    .get(`/users/${organizationId}`)
    .set(Object.assign({}, authorizationHeaders, {
      'x-stelace-organization-id': organizationId
    }))
    .expect(200)

  t.is(organization.orgOwnerId, userId)

  const { body: organizationAfterTransfer1 } = await request(t.context.serverUrl)
    .patch(`/users/${organizationId}`)
    .set(Object.assign({}, authorizationHeaders, {
      // Impersonating org lets us edit the org without 'user:edit:all' permission
      'x-stelace-organization-id': organizationId
    }))
    .send({ orgOwnerId: newOwnerId })
    .expect(200)

  t.is(organizationAfterTransfer1.orgOwnerId, newOwnerId)

  // 'dev' role within org automatically granted
  const { body: secondOwnerAfterTransfer1 } = await request(t.context.serverUrl)
    .get(`/users/${newOwnerId}`)
    .set(authorizationHeaders)
    .expect(200)

  const secondOwnerRolesAfterTransfer1 = secondOwnerAfterTransfer1.organizations[organizationId].roles
  t.deepEqual(secondOwnerRolesAfterTransfer1, ['dev'])

  // Switch back to first owner and check roles integrity

  await request(t.context.serverUrl)
    .patch(`/users/${organizationId}`)
    .set(Object.assign({}, authorizationHeaders, {
      'x-stelace-organization-id': organizationId
    }))
    .send({ orgOwnerId: userId })
    .expect(403) // Does not work since userId of authorizationHeaders is not owner anymore

  const authorizationHeaders2 = await getAccessTokenHeaders({
    t,
    permissions: [
      'user:read:all',
      'user:edit:all' // Works with this permission, even if userId is not owner anymore
    ],
    userId
  })

  await request(t.context.serverUrl)
    .patch(`/users/${organizationId}`)
    .set(authorizationHeaders2)
    .send({ orgOwnerId: newOwnerId }) // using same owner
    .expect(200)

  const authorizationHeaders3 = await getAccessTokenHeaders({
    t,
    permissions: [
      'user:read:all',
      'user:edit:all'
    ],
    userId: newOwnerId
  })

  const { body: organizationAfterTransfers } = await request(t.context.serverUrl)
    .patch(`/users/${organizationId}`)
    .set(authorizationHeaders3)
    .send({ orgOwnerId: userId })
    .expect(200)

  t.is(organizationAfterTransfers.orgOwnerId, userId)

  const { body: firstOwnerAfterTransfers } = await request(t.context.serverUrl)
    .get(`/users/${userId}`)
    .set(authorizationHeaders)
    .expect(200)

  const firstOwnerRolesAfterTransfers = firstOwnerAfterTransfers.organizations[organizationId].roles
  t.true(firstOwnerRolesAfterTransfers.includes('dev'))
  // Preserving existing roles after granting new owner with 'dev' role
  t.true(firstOwnerRolesBeforeTransfers.every(r => firstOwnerRolesAfterTransfers.includes(r)))

  const { body: secondOwnerAfterTransfers } = await request(t.context.serverUrl)
    .get(`/users/${newOwnerId}`)
    .set(authorizationHeaders)
    .expect(200)

  const secondOwnerRolesAfterTransfers = secondOwnerAfterTransfers.organizations[organizationId].roles
  // Not removing 'dev' role
  t.deepEqual(secondOwnerRolesAfterTransfers, secondOwnerRolesAfterTransfer1)
})

test('cannot update an organization as a plain user without x-stelace-organization-id header', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['user:edit'],
    userId: 'usr_WHlfQps1I3a1gJYz2I3a'
  })
  const organizationId = 'org_xC3ZlGs1Jo71gb2G0Jo7'

  await request(t.context.serverUrl)
    .patch(`/users/${organizationId}`)
    .set(authorizationHeaders)
    .send({ metadata: { comment: 'Updated organization' } })
    .expect(403)

  let comment = 'Updated organization with organization-id header'
  const { body: updated1 } = await request(t.context.serverUrl)
    .patch(`/users/${organizationId}`)
    .set(Object.assign({}, authorizationHeaders, {
      'x-stelace-organization-id': organizationId
    }))
    .send({ metadata: { comment } })
    .expect(200)

  t.is(updated1.metadata.comment, comment)

  const authorizationHeaders2 = await getAccessTokenHeaders({
    t,
    permissions: ['user:edit:all'], // 'dev' permission
    userId: 'usr_WHlfQps1I3a1gJYz2I3a'
  })

  comment = 'Updated organization with user:edit:all permission'
  const { body: updated2 } = await request(t.context.serverUrl)
    .patch(`/users/${organizationId}`)
    .set(authorizationHeaders2)
    .send({ metadata: { comment } })
    .expect(200)

  t.is(updated2.metadata.comment, comment)
})

test('updates a user’s rights in organization', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'user:configOrganization'
    ]
  })

  // the current user belongs to the org 'org_yiBSnhs1zaP1hh8rczaP'

  const { body: user } = await request(t.context.serverUrl)
    .put('/users/usr_Y0tfQps1I3a1gJYz2I3a/organizations/org_yiBSnhs1zaP1hh8rczaP')
    .set(authorizationHeaders)
    .send({
      roles: ['user', 'provider']
    })
    .expect(200)

  t.deepEqual(user.organizations.org_yiBSnhs1zaP1hh8rczaP.roles, ['user', 'provider'])
})

test('updates a user’s rights in organization with API key', async (t) => {
  // API key has the permission 'user:configOrganization:all'

  const { body: user } = await request(t.context.serverUrl)
    // DEPRECATED in favor of put method below, to uncomment when removing patch endpoint.
    .patch('/users/usr_Y0tfQps1I3a1gJYz2I3a/organizations/org_yiBSnhs1zaP1hh8rczaP')
    // .put('/users/usr_Y0tfQps1I3a1gJYz2I3a/organizations/org_yiBSnhs1zaP1hh8rczaP')
    .set({
      authorization: `Basic ${encodeBase64('seck_live_iuJzTKo5wumuE1imSjmcgimR:')}`,
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      roles: ['user', 'provider']
    })
    .expect(200)

  t.deepEqual(user.organizations.org_yiBSnhs1zaP1hh8rczaP.roles, ['user', 'provider'])
})

test('cannot update a user’s rights in an invalid organization', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'user:configOrganization'
    ]
  })

  const { body: error } = await request(t.context.serverUrl)
    .put('/users/usr_Y0tfQps1I3a1gJYz2I3a/organizations/usr_Y0tfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      roles: ['user', 'provider']
    })
    .expect(422)

  t.regex(error.message, /unknown/i)
})

test('updates any organization rights with "user:configOrganization:all" permission', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'user:configOrganization:all'
    ],
    userId: 'external-user-id'
  })

  // the current user does not belongs to the org 'org_yiBSnhs1zaP1hh8rczaP'

  const { body: user } = await request(t.context.serverUrl)
    .put('/users/usr_Y0tfQps1I3a1gJYz2I3a/organizations/org_yiBSnhs1zaP1hh8rczaP')
    .set(authorizationHeaders)
    .send({
      roles: ['user', 'provider']
    })
    .expect(200)

  t.deepEqual(user.organizations.org_yiBSnhs1zaP1hh8rczaP.roles, ['user', 'provider'])
})

test('removes a user’s from own organization', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'user:configOrganization'
    ]
  })

  // the current user belongs to the org 'org_yiBSnhs1zaP1hh8rczaP'

  const { body: user } = await request(t.context.serverUrl)
    .delete('/users/usr_em9SToe1nI01iG4yRnHz/organizations/org_yiBSnhs1zaP1hh8rczaP')
    .set(authorizationHeaders)
    .expect(200)

  t.is(user.organizations.org_yiBSnhs1zaP1hh8rczaP, undefined)
})

test('cannot update the username of an organization', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['user:edit:all'] })

  await request(t.context.serverUrl)
    .patch('/users/org_toMLWis1EpB1gwNcfEpB')
    .set(authorizationHeaders)
    .send({
      username: 'username'
    })
    .expect(400)

  t.pass()
})

test('removes a user', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'user:read:all',
      'user:create:all',
      'user:remove:all'
    ]
  })

  const { body: user } = await request(t.context.serverUrl)
    .post('/users')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      username: 'userToRemove',
      password: 'secretPassword'
    })
    .expect(200)

  const result = await request(t.context.serverUrl)
    .delete(`/users/${user.id}`)
    .set(authorizationHeaders)
    .expect(200)

  const payload = result.body

  t.is(payload.id, user.id)

  await request(t.context.serverUrl)
    .get(`/users/${user.id}`)
    .set(authorizationHeaders)
    .expect(404)
})

test('cannot remove a user that have assets', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['user:remove:all'] })

  await request(t.context.serverUrl)
    .delete('/users/usr_WHlfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(422)

  t.pass()
})

test('cannot remove a user who owns some organization', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'user:read:all',
      'user:remove:all'
    ]
  })

  // The organization 'org_4YsuuQe1X0h1hznSoX0g' is owned by 'usr_Y0tfQps1I3a1gJYz2I3a'
  await request(t.context.serverUrl)
    .get('/users/usr_Y0tfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  const { body: error } = await request(t.context.serverUrl)
    .delete('/users/usr_Y0tfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(422)

  t.true(error.message.includes('own'))
  t.true(Array.isArray(error.data.ownedOrganizationIds))
  t.true(error.data.ownedOrganizationIds.includes('org_4YsuuQe1X0h1hznSoX0g'))
})

test('removes an organization', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'user:read:all',
      'user:remove'
    ],
    userId: 'usr_Y0tfQps1I3a1gJYz2I3a'
  })

  await request(t.context.serverUrl)
    .get('/users/org_4YsuuQe1X0h1hznSoX0g')
    .set(authorizationHeaders)
    .expect(200)

  const { body: payload } = await request(t.context.serverUrl)
    .delete('/users/org_4YsuuQe1X0h1hznSoX0g')
    .set(Object.assign({}, authorizationHeaders, {
      'x-stelace-organization-id': 'org_4YsuuQe1X0h1hznSoX0g'
    }))
    .expect(200)

  t.is(payload.id, 'org_4YsuuQe1X0h1hznSoX0g')

  await request(t.context.serverUrl)
    .get('/users/org_4YsuuQe1X0h1hznSoX0g')
    .set(authorizationHeaders)
    .expect(404)

  // Works as a user too (organization owner)
  await request(t.context.serverUrl)
    .delete('/users/org_4YsuuQe1X0h1hznSoX0g')
    .set(authorizationHeaders)
    .expect(200)
})

test('cannot remove an organization as non-owner without "user:remove:all" permission', async (t) => {
  const userId = 'usr_AAtfQps1I3a1gJYz2I3a' // not owner
  const organizationId = 'org_VPq2HKe1uSC1iNF5JuSB'

  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'user:read:all',
      'user:remove'
    ],
    userId
  })

  const { body: error } = await request(t.context.serverUrl)
    .delete(`/users/${organizationId}`)
    .set(authorizationHeaders)
    .expect(403)

  t.true(error.message.includes('owner'))
})

test('removing an organization automatically makes members leave the org', async (t) => {
  const userIds = ['usr_Y0tfQps1I3a1gJYz2I3a', 'usr_AAtfQps1I3a1gJYz2I3a']
  const organizationId = 'org_VPq2HKe1uSC1iNF5JuSB'

  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'event:list:all',
      'user:read:all',
      'user:remove'
    ],
    userId: userIds[0]
  })

  const { body: { results: beforeUsers } } = await request(t.context.serverUrl)
    .get(`/users?id=${userIds.join(',')}`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(beforeUsers.every(u => u.organizations[organizationId]))

  await request(t.context.serverUrl)
    .delete(`/users/${organizationId}`)
    .set(Object.assign({}, authorizationHeaders, {
      'x-stelace-organization-id': organizationId
    }))
    .expect(200)

  const { body: { results: afterUsers } } = await request(t.context.serverUrl)
    .get(`/users?id=${userIds.join(',')}`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(afterUsers.every(u => u.organizations[organizationId] === undefined))

  // Checking event data for all leaving users, including owner

  let { body: { results: eventsAfterLeavingOrg } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders)
    .expect(200)

  eventsAfterLeavingOrg = eventsAfterLeavingOrg.filter(
    e => e.relatedObjectsIds.organizationId === organizationId
  )

  const checkLeavingUserEvent = async (userId) => {
    const { body: userUpdatedAfterLeavingOrg } = await request(t.context.serverUrl)
      .get(`/users/${userId}`)
      .set(authorizationHeaders)
      .expect(200)

    const userOrgLeftEvent = getObjectEvent({
      events: eventsAfterLeavingOrg,
      eventType: 'user__organization_left',
      objectId: userId
    })

    await testEventMetadata({
      event: userOrgLeftEvent,
      relatedObjectsIds: { organizationId: organizationId },
      object: userUpdatedAfterLeavingOrg,
      metadata: { stelaceComment: 'Organization deleted' },
      t
    })
  }

  await bluebird.map(userIds, checkLeavingUserEvent)
})

test('cannot remove an organization if it is the parent of other organizations', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['user:remove:all'],
    userId: 'usr_QVQfQps1I3a1gJYz2I3a'
  })

  await request(t.context.serverUrl)
    .delete('/users/org_toMLWis1EpB1gwNcfEpB')
    .set(Object.assign({}, authorizationHeaders, {
      'x-stelace-organization-id': 'org_toMLWis1EpB1gwNcfEpB'
    }))
    .expect(403) // 'x-stelace-organization-id' overwrites 'user:remove:all' with org permissions

  await request(t.context.serverUrl)
    .delete('/users/org_toMLWis1EpB1gwNcfEpB')
    .set(authorizationHeaders)
    .expect(422)

  t.pass()
})

// ////////// //
// VALIDATION //
// ////////// //

test('fails to create a user if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .post('/users')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // missing required parameters
  result = await request(t.context.serverUrl)
    .post('/users')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({})
    .expect(400)

  error = result.body
  t.true(error.message.includes('"username" is required'))
  t.true(error.message.includes('"password" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .post('/users')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      username: true,
      password: true,
      description: true,
      displayName: true,
      firstname: true,
      lastname: true,
      email: true,
      roles: true,
      organizations: true,
      metadata: true,
      platformData: true,
      type: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"username" must be a string'))
  t.true(error.message.includes('"password" must be a string'))
  t.true(error.message.includes('"description" must be a string'))
  t.true(error.message.includes('"displayName" must be a string'))
  t.true(error.message.includes('"firstname" must be a string'))
  t.true(error.message.includes('"lastname" must be a string'))
  t.true(error.message.includes('"email" must be a string'))
  t.true(error.message.includes('"roles" must be an array'))
  t.true(error.message.includes('"organizations" must be of type object'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
  t.true(error.message.includes('"type" must be a string'))
})

test('fails to update a user if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .patch('/users/usr_WHlfQps1I3a1gJYz2I3a')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .patch('/users/usr_WHlfQps1I3a1gJYz2I3a')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      username: true,
      description: true,
      displayName: true,
      firstname: true,
      lastname: true,
      email: true,
      roles: true,
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"username" must be a string'))
  t.true(error.message.includes('"description" must be a string'))
  t.true(error.message.includes('"displayName" must be a string'))
  t.true(error.message.includes('"roles" must be an array'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

test('fails to change organization config if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .put('/users/usr_WHlfQps1I3a1gJYz2I3a/organizations/org_xC3ZlGs1Jo71gb2G0Jo7')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .put('/users/usr_WHlfQps1I3a1gJYz2I3a/organizations/org_xC3ZlGs1Jo71gb2G0Jo7')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      roles: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"roles" must be an array'))
})

// ////// //
// EVENTS //
// ////// //

// Event tests must run serially before the other tests
test.serial('generates user__* events', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'user:create:all',
      'user:edit:all',
      'user:remove:all',
      'event:list:all',
      'platformData:edit:all'
    ],
    readNamespaces: ['*'],
    editNamespaces: ['*']
  })

  const userId = 'usr_Y0tfQps1I3a1gJYz2I3a'
  const authorizationHeaders2 = await getAccessTokenHeaders({
    t,
    permissions: [
      'user:read:all',
      'user:create:all',
      'user:edit:all',
      'user:remove:all',
      'event:list:all',
      'organization:create',
      'platformData:edit:all'
    ],
    readNamespaces: ['*'],
    editNamespaces: ['*'],
    userId
  })

  const { body: user } = await request(t.context.serverUrl)
    .post('/users')
    .set(authorizationHeaders)
    .send({
      username: _.uniqueId('randomUser'),
      password: _.uniqueId('randomPassword'),
      metadata: {
        _private: {
          firstname: 'Random',
          lastname: 'RANDOM'
        },
        dummy: true
      }
    })
    .expect(200)

  const patchPayload = {
    metadata: {
      _private: {
        firstname: 'Matt'
      },
      dummy: false
    },
    platformData: {
      test: 1
    }
  }

  const { body: userUpdated } = await request(t.context.serverUrl)
    .patch(`/users/${user.id}`)
    .set(authorizationHeaders)
    .send(patchPayload)
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 300))

  const { body: { results: events } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders)
    .expect(200)

  const userCreatedEvent = getObjectEvent({
    events,
    eventType: 'user__created',
    objectId: user.id
  })
  await testEventMetadata({ event: userCreatedEvent, object: user, t })
  t.is(userCreatedEvent.object.username, user.username)
  t.is(userCreatedEvent.object.password, user.password)
  t.is(userCreatedEvent.object.metadata._private.firstname, 'Random')

  const userUpdatedEvent = getObjectEvent({
    events,
    eventType: 'user__updated',
    objectId: userUpdated.id
  })
  await testEventMetadata({
    event: userUpdatedEvent,
    object: userUpdated,
    t,
    patchPayload
  })
  t.is(userUpdatedEvent.object.username, userUpdated.username)
  t.is(userUpdatedEvent.object.password, userUpdated.password)
  t.is(userUpdatedEvent.object.metadata._private.firstname, 'Matt')

  await request(t.context.serverUrl)
    .delete(`/users/${userUpdated.id}`)
    .set(authorizationHeaders)
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 300))

  const { body: { results: eventsAfterDelete } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders)
    .expect(200)

  const userDeletedEvent = getObjectEvent({
    events: eventsAfterDelete,
    eventType: 'user__deleted',
    objectId: userUpdated.id
  })
  await testEventMetadata({ event: userDeletedEvent, object: userUpdated, t })
  t.is(userDeletedEvent.object.username, userUpdated.username)
  t.is(userDeletedEvent.object.password, userUpdated.password)
  t.is(userDeletedEvent.object.metadata._private.firstname, 'Matt')

  // organization events
  const { body: organization } = await request(t.context.serverUrl)
    .post('/users')
    .set(authorizationHeaders2)
    .send({ type: 'organization' })
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 300))

  const { body: userUpdatedAfterCreatingOrg } = await request(t.context.serverUrl)
    .get(`/users/${userId}`)
    .set(authorizationHeaders2)
    .expect(200)

  const { body: { results: eventsAfterCreatingOrg } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders2)
    .expect(200)

  const orgCreatedEvent = getObjectEvent({
    events: eventsAfterCreatingOrg,
    eventType: 'user__created',
    objectId: organization.id
  })
  await testEventMetadata({ event: orgCreatedEvent, object: organization, t })

  const userOrgJoinedEvent = getObjectEvent({
    events: eventsAfterCreatingOrg,
    eventType: 'user__organization_joined',
    objectId: userId
  })

  await testEventMetadata({
    event: userOrgJoinedEvent,
    relatedObjectsIds: { organizationId: organization.id },
    object: userUpdatedAfterCreatingOrg,
    t
  })

  // Changing rights within organization

  await request(t.context.serverUrl)
    .put(`/users/${userId}/organizations/${organization.id}`)
    .set(Object.assign({}, authorizationHeaders2, { 'x-stelace-organization-id': organization.id }))
    .send({ roles: ['dev', 'user'] })
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 300))

  const { body: userUpdatedAfterChangingOrgRights } = await request(t.context.serverUrl)
    .get(`/users/${userId}`)
    .set(authorizationHeaders2)
    .expect(200)

  const { body: { results: eventsAfterChangingOrgRights } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders2)
    .expect(200)

  const orgRightsChangedEvent = getObjectEvent({
    events: eventsAfterChangingOrgRights,
    eventType: 'user__organization_rights_changed',
    objectId: userId
  })
  await testEventMetadata({
    event: orgRightsChangedEvent,
    relatedObjectsIds: { organizationId: organization.id },
    object: userUpdatedAfterChangingOrgRights,
    patchPayload: { roles: ['dev', 'user'] },
    t
  })

  // Deleting organization

  await request(t.context.serverUrl)
    .delete(`/users/${organization.id}`)
    .set(Object.assign({}, authorizationHeaders2, { 'x-stelace-organization-id': organization.id }))
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 300))

  const { body: userUpdatedAfterDeletingOrg } = await request(t.context.serverUrl)
    .get(`/users/${userId}`)
    .set(authorizationHeaders2)
    .expect(200)

  const { body: { results: eventsAfterDeletingOrg } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders2)
    .expect(200)

  const orgDeletedEvent = getObjectEvent({
    events: eventsAfterDeletingOrg,
    eventType: 'user__deleted',
    objectId: organization.id
  })
  await testEventMetadata({ event: orgDeletedEvent, object: organization, t })

  const userOrgLeftEvent = getObjectEvent({
    events: eventsAfterDeletingOrg,
    eventType: 'user__organization_left',
    objectId: userId
  })

  await testEventMetadata({
    event: userOrgLeftEvent,
    // adding relatedObjectId
    relatedObjectsIds: { organizationId: organization.id },
    object: userUpdatedAfterDeletingOrg,
    t
  })
})

// //////// //
// VERSIONS //
// //////// //

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('2019-05-20: list users with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['user:list:all']
  })

  await checkOffsetPaginationScenario({
    t,
    endpointUrl: '/users',
    authorizationHeaders,
  })
})

test('2019-05-20: list users with id filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['user:list:all']
  })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/users?id=usr_WHlfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  checkOffsetPaginatedListObject(t, obj)
  t.is(obj.nbResults, 1)
})

test('2019-05-20: list users with query filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['user:list:all']
  })

  const query = 'user2'

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/users?query=${query}`)
    .set(authorizationHeaders)
    .expect(200)

  checkOffsetPaginatedListObject(t, obj)
  t.is(obj.nbResults, 1)

  obj.results.forEach(user => {
    const fields = [
      'displayName',
      'firstname',
      'lastname',
      'username',
      'email'
    ]

    const matchQuery = fields.some(field => {
      return user[field] && user[field].toLowerCase().replace(/\s/gi, '').includes(query)
    })

    t.true(matchQuery)
  })
})

test('2019-05-20: list users without type should only return natural users', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['user:list:all']
  })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/users')
    .set(authorizationHeaders)
    .expect(200)

  const checkResultsFn = (t, user) => t.true(!user.roles.includes('organization'))
  checkOffsetPaginatedListObject(t, obj, { checkResultsFn })
})

test('2019-05-20: list organization users', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['user:list:all']
  })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/users?type=organization')
    .set(authorizationHeaders)
    .expect(200)

  const checkResultsFn = (t, user) => t.true(user.roles.includes('organization'))
  checkOffsetPaginatedListObject(t, obj, { checkResultsFn })
})

test('2019-05-20: list users and organizations', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['user:list:all']
  })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/users?type=all')
    .set(authorizationHeaders)
    .expect(200)

  let hasUsers = false
  let hasOrganizations = false

  const checkResultsFn = (t, user) => {
    const isOrg = user.roles.includes('organization')

    hasUsers = hasUsers || !isOrg
    hasOrganizations = hasOrganizations || isOrg
  }
  checkOffsetPaginatedListObject(t, obj, { checkResultsFn })

  t.true(hasUsers)
  t.true(hasOrganizations)
})

test('2019-05-20: list users and organizations filtering by IDs without providing type', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['user:list:all']
  })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/users?id[]=usr_WHlfQps1I3a1gJYz2I3a&id[]=org_xC3ZlGs1Jo71gb2G0Jo7')
    .set(authorizationHeaders)
    .expect(200)

  const checkResultsFn = (t, user) => {
    t.true(['usr_WHlfQps1I3a1gJYz2I3a', 'org_xC3ZlGs1Jo71gb2G0Jo7'].includes(user.id))
  }
  checkOffsetPaginatedListObject(t, obj, { checkResultsFn })
})

test('2019-05-20: list members of an organization using userOrganizationId filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['user:list:all']
  })

  const orgId = 'org_yiBSnhs1zaP1hh8rczaP'
  const { body: obj } = await request(t.context.serverUrl)
    .get(`/users?userOrganizationId=${orgId}`)
    .set(authorizationHeaders)
    .expect(200)

  const checkResultsFn = (t, user) => t.true(Object.keys(user.organizations).includes(orgId))
  checkOffsetPaginatedListObject(t, obj, { checkResultsFn })
  t.is(obj.nbResults, 3)
  t.is(obj.nbPages, 1)
})

test('2019-05-20: list user belonging to every listed using userOrganizationId filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['user:list:all']
  })

  const orgIds = ['org_xC3ZlGs1Jo71gb2G0Jo7', 'org_yiBSnhs1zaP1hh8rczaP']
  const { body: obj } = await request(t.context.serverUrl)
    .get(`/users?userOrganizationId=${orgIds.join(',')}`)
    .set(authorizationHeaders)
    .expect(200)

  const checkResultsFn = (t, user) => {
    t.true(orgIds.every(id => Object.keys(user.organizations).includes(id)))
  }
  checkOffsetPaginatedListObject(t, obj, { checkResultsFn })
  t.is(obj.nbResults, 1)
})
