require('dotenv').config()

const test = require('ava')
const request = require('supertest')
const _ = require('lodash')

const {
  testTools: { lifecycle, auth, util }
} = require('../../serverTooling')

const { before, beforeEach, after } = lifecycle
const { getAccessTokenHeaders } = auth
const {
  checkOffsetPaginationScenario,
  checkOffsetPaginatedListObject,
  checkOffsetPaginatedStatsObject,

  checkCursorPaginationScenario,
  checkCursorPaginatedListObject,
  checkCursorPaginatedStatsObject,

  checkFilters,
} = util

test.before(async t => {
  await before({ name: 'rating' })(t)
  await beforeEach()(t)
})
// test.beforeEach(beforeEach()) // Concurrent tests are much faster
test.after(after())

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('gets simple rating stats with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['rating:stats:all'] })

  await checkCursorPaginationScenario({
    t,
    endpointUrl: '/ratings/stats?groupBy=authorId',
    authorizationHeaders,
    orderBy: 'avg'
  })
})

// run this test serially because there is no filter and some other tests create events
// that can turn the check on `count` property incorrect
test.serial('gets simple rating stats', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'rating:stats:all',
      'rating:list:all'
    ]
  })

  const groupBy = 'authorId'

  const { body: { results: ratings } } = await request(t.context.serverUrl)
    .get('/ratings')
    .set(authorizationHeaders)
    .expect(200)

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/ratings/stats?groupBy=${groupBy}`)
    .set(authorizationHeaders)
    .expect(200)

  checkCursorPaginatedStatsObject({
    t,
    obj,
    groupBy,
    field: 'score', // implicit for Rating API
    avgPrecision: 0, // implicit for Rating API
    results: ratings,
    orderBy: 'avg',
    order: 'desc',
    expandedGroupByField: false
  })

  // cf. plugin middleware test below
  t.is(typeof obj.workingTestMiddleware, 'undefined')
})

test('integrates plugin middleware', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['rating:stats:all'] })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/ratings/test?groupBy=authorId')
    .set(authorizationHeaders)
    .expect(200)

  t.true(typeof obj === 'object')
  t.true(Array.isArray(obj.results))
  t.true(obj.workingTestMiddleware)
})

// run this test serially because there is no filter and some other tests create events
// that can turn the check on `count` property incorrect
test.serial('gets aggregated rating stats with ranking', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'rating:stats:all',
      'rating:list:all'
    ]
  })

  const groupBy = 'authorId'

  const { body: { results: ratings } } = await request(t.context.serverUrl)
    .get('/ratings')
    .set(authorizationHeaders)
    .expect(200)

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/ratings/stats?groupBy=${groupBy}&computeRanking=true`)
    .set(authorizationHeaders)
    .expect(200)

  let ranking

  checkCursorPaginatedStatsObject({
    t,
    obj,
    groupBy,
    field: 'score', // implicit for Rating API
    avgPrecision: 0, // implicit for Rating API
    results: ratings,
    orderBy: 'avg',
    order: 'desc',
    expandedGroupByField: false,
    additionalResultCheckFn: (result) => {
      t.is(typeof result.ranking, 'number')
      t.is(typeof result.lowestRanking, 'number')

      t.is(result.lowestRanking, obj.results.length) // is true because there is no filter

      // check ranking order
      if (typeof ranking === 'undefined') {
        ranking = result.ranking
      } else {
        t.true(ranking < result.ranking)
      }
    }
  })
})

test('gets aggregated rating stats with wildcard label', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'rating:list:all',
      'rating:stats:all'
    ]
  })

  const authorId = 'usr_WHlfQps1I3a1gJYz2I3a'

  const { body: { results: ratings } } = await request(t.context.serverUrl)
    .get(`/ratings?authorId=${authorId}&label=main:*`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: { results } } = await request(t.context.serverUrl)
    .get(`/ratings/stats?groupBy=authorId&label=main:*&authorId=${authorId}`)
    .set(authorizationHeaders)
    .expect(200)

  const nbRatings = ratings.length
  const avgRatings = Math.round(ratings.reduce((memo, rating) => memo + rating.score, 0) / nbRatings)

  t.is(avgRatings, results[0].avg)
})

test('gets aggregated rating stats with multiple labels', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'rating:stats:all'
    ]
  })

  const authorId = 'usr_WHlfQps1I3a1gJYz2I3a'

  const { body: { results } } = await request(t.context.serverUrl)
    .get(`/ratings/stats?groupBy=authorId&label=main:*,main:friendliness,main:pricing&authorId=${authorId}`)
    .set(authorizationHeaders)
    .expect(200)

  const checkStatObject = obj => {
    t.is(typeof obj, 'object')
    t.is(obj.authorId, authorId)
    t.is(typeof obj.count, 'number')
    t.is(typeof obj.sum, 'number')
    t.is(typeof obj.avg, 'number')
    t.is(typeof obj.min, 'number')
    t.is(typeof obj.max, 'number')
  }

  checkStatObject(results[0]['main:*'])
  checkStatObject(results[0]['main:friendliness'])
  checkStatObject(results[0]['main:pricing'])
})

// use serial because no changes must be made during the check
test.serial('check history filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'rating:stats:all',
      'rating:list:all',
    ]
  })

  const groupBys = [
    'authorId', // document first-level property
    'assetId', // document data sub-property
  ]

  for (const groupBy of groupBys) {
    const { body: { results } } = await request(t.context.serverUrl)
      .get('/ratings?nbResultsPerPage=100')
      .set(authorizationHeaders)
      .expect(200)

    const resultsByGroupBy = _.groupBy(results, groupBy)

    const customExactValueCheck = _.curry((prop, obj, value) => {
      let filteredResults = resultsByGroupBy[obj[groupBy]] || []
      filteredResults = filteredResults.filter(r => r[prop] === value)
      return filteredResults.length === obj.count
    })

    const customArrayValuesCheck = _.curry((prop, obj, values) => {
      let filteredResults = resultsByGroupBy[obj[groupBy]] || []
      filteredResults = filteredResults.filter(r => values.includes(r[prop]))
      return filteredResults.length === obj.count
    })

    await checkFilters({
      t,
      endpointUrl: `/ratings/stats?groupBy=${groupBy}`,
      fetchEndpointUrl: '/ratings',
      authorizationHeaders,
      checkPaginationObject: checkCursorPaginatedListObject,

      filters: [
        {
          prop: 'authorId',
          customExactValueFilterCheck: customExactValueCheck('authorId'),
          customArrayFilterCheck: customArrayValuesCheck('authorId'),
        },
        {
          prop: 'targetId',
          customExactValueFilterCheck: customExactValueCheck('targetId'),
          customArrayFilterCheck: customArrayValuesCheck('targetId'),
        },
        {
          prop: 'assetId',
          customExactValueFilterCheck: customExactValueCheck('assetId'),
        },
        {
          prop: 'transactionId',
          customExactValueFilterCheck: customExactValueCheck('transactionId'),
        },
        {
          prop: 'label',
          // multiple labels filter on stats are tested on other tests
          customExactValueFilterCheck: customExactValueCheck('label'),
        },
      ],
    })
  }
})

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('lists ratings with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['rating:list:all'] })

  await checkCursorPaginationScenario({
    t,
    endpointUrl: '/ratings',
    authorizationHeaders,
  })
})

test('lists ratings with id filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['rating:list:all'] })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/ratings?id=rtg_2l7fQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  checkCursorPaginatedListObject(t, obj)
  t.is(obj.results.length, 1)
})

// use serial because no changes must be made during the check
test.serial('check list filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['rating:list:all'] })

  await checkFilters({
    t,
    endpointUrl: '/ratings',
    authorizationHeaders,
    checkPaginationObject: checkCursorPaginatedListObject,

    filters: [
      {
        prop: 'id',
        isArrayFilter: true,
      },
      {
        prop: 'authorId',
        isArrayFilter: true,
      },
      {
        prop: 'targetId',
        isArrayFilter: true,
      },
      {
        prop: 'assetId',
      },
      {
        prop: 'transactionId',
      },
      {
        prop: 'label',
        isArrayFilter: true,
      },
    ],
  })
})

test('lists ratings with advanced filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['rating:list:all'] })

  const result1 = await request(t.context.serverUrl)
    .get('/ratings?authorId=usr_WHlfQps1I3a1gJYz2I3a,user-external-id')
    .set(authorizationHeaders)
    .expect(200)

  const obj1 = result1.body

  obj1.results.forEach(rating => {
    t.true(['usr_WHlfQps1I3a1gJYz2I3a', 'user-external-id'].includes(rating.authorId))
  })

  const result2 = await request(t.context.serverUrl)
    .get('/ratings?authorId[]=usr_WHlfQps1I3a1gJYz2I3a&authorId[]=user-external-id')
    .set(authorizationHeaders)
    .expect(200)

  const obj2 = result2.body

  obj2.results.forEach(rating => {
    t.true(['usr_WHlfQps1I3a1gJYz2I3a', 'user-external-id'].includes(rating.authorId))
  })

  const result3 = await request(t.context.serverUrl)
    .get('/ratings?targetId=usr_T2VfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  const obj3 = result3.body

  obj3.results.forEach(rating => {
    t.true(['usr_T2VfQps1I3a1gJYz2I3a'].includes(rating.targetId))
  })

  const result4 = await request(t.context.serverUrl)
    .get('/ratings?assetId=ast_0TYM7rs1OwP1gQRuCOwP&transactionId=trn_UG1fQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  const obj4 = result4.body

  obj4.results.forEach(rating => {
    t.true(['ast_0TYM7rs1OwP1gQRuCOwP'].includes(rating.assetId))
    t.true(['trn_UG1fQps1I3a1gJYz2I3a'].includes(rating.transactionId))
  })
})

test('lists ratings with label filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['rating:list:all'] })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/ratings?label=main:friendliness,main:pricing')
    .set(authorizationHeaders)
    .expect(200)

  const checkResultsFn = (t, rating) => {
    t.true(['main:friendliness', 'main:pricing'].includes(rating.label))
  }

  checkCursorPaginatedListObject(t, obj, { checkResultsFn })
})

test('lists ratings with wildcard label filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['rating:list:all'] })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/ratings?label=main:*')
    .set(authorizationHeaders)
    .expect(200)

  const checkResultsFn = (t, rating) => t.true(rating.label.startsWith('main:'))
  checkCursorPaginatedListObject(t, obj, { checkResultsFn })
})

test('finds a rating', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['rating:read:all'] })

  const { body: rating } = await request(t.context.serverUrl)
    .get('/ratings/rtg_2l7fQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  t.is(rating.id, 'rtg_2l7fQps1I3a1gJYz2I3a')
  t.is(rating.authorId, 'user-external-id')
  t.is(rating.targetId, 'usr_Y0tfQps1I3a1gJYz2I3a')
  t.is(rating.score, 80)
  t.is(rating.comment, 'Wonderful')
  t.deepEqual(rating.metadata.existingData, [true])
})

test('creates a rating', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['rating:create:all']
  })

  const { body: rating } = await request(t.context.serverUrl)
    .post('/ratings')
    .set(authorizationHeaders)
    .send({
      score: 100,
      comment: 'Wonderful',
      targetId: 'usr_Y0tfQps1I3a1gJYz2I3a',
      assetId: 'ast_0TYM7rs1OwP1gQRuCOwP',
      transactionId: 'trn_a3BfQps1I3a1gJYz2I3a',
      metadata: { dummy: true }
    })
    .expect(200)

  t.is(rating.score, 100)
  t.is(rating.comment, 'Wonderful')
  t.is(rating.targetId, 'usr_Y0tfQps1I3a1gJYz2I3a')
  t.is(rating.assetId, 'ast_0TYM7rs1OwP1gQRuCOwP')
  t.is(rating.transactionId, 'trn_a3BfQps1I3a1gJYz2I3a')
  t.is(rating.metadata.dummy, true)
})

test('sets assetId automatically when creating a rating with a transaction and without an asset', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['rating:create:all']
  })

  const { body: rating } = await request(t.context.serverUrl)
    .post('/ratings')
    .set(authorizationHeaders)
    .send({
      score: 100,
      comment: 'Wonderful',
      targetId: 'usr_Y0tfQps1I3a1gJYz2I3a',
      transactionId: 'trn_a3BfQps1I3a1gJYz2I3a',
      metadata: { dummy: true }
    })
    .expect(200)

  t.is(rating.score, 100)
  t.is(rating.comment, 'Wonderful')
  t.is(rating.targetId, 'usr_Y0tfQps1I3a1gJYz2I3a')
  t.is(rating.assetId, 'ast_0TYM7rs1OwP1gQRuCOwP')
  t.is(rating.label, null)
  t.is(rating.metadata.dummy, true)
})

test('creates a rating with a label', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['rating:create:all']
  })

  const { body: rating } = await request(t.context.serverUrl)
    .post('/ratings')
    .set(authorizationHeaders)
    .send({
      score: 100,
      comment: 'Wonderful',
      targetId: 'usr_Y0tfQps1I3a1gJYz2I3a',
      assetId: 'ast_0TYM7rs1OwP1gQRuCOwP',
      transactionId: 'trn_a3BfQps1I3a1gJYz2I3a',
      label: 'main:friendliness',
      metadata: { dummy: true }
    })
    .expect(200)

  t.is(rating.score, 100)
  t.is(rating.comment, 'Wonderful')
  t.is(rating.targetId, 'usr_Y0tfQps1I3a1gJYz2I3a')
  t.is(rating.assetId, 'ast_0TYM7rs1OwP1gQRuCOwP')
  t.is(rating.transactionId, 'trn_a3BfQps1I3a1gJYz2I3a')
  t.is(rating.label, 'main:friendliness')
  t.is(rating.metadata.dummy, true)
})

test('throws an error when creating a rating with bad reference', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['rating:create:all']
  })

  await request(t.context.serverUrl)
    .post('/ratings')
    .set(authorizationHeaders)
    .send({
      score: 100,
      comment: 'Wonderful',
      targetId: 'usr_Y0tfQps1I3a1gJYz2I3a',
      assetId: 'ast_0TYM7rs1OwP1gQRuCOwW', // non existing asset
      metadata: { dummy: true }
    })
    .expect(422)

  await request(t.context.serverUrl)
    .post('/ratings')
    .set(authorizationHeaders)
    .send({
      score: 100,
      comment: 'Wonderful',
      targetId: 'usr_Y0tfQps1I3a1gJYz2I3a',
      transactionId: 'trn_a3BfQps1I3a1gJYz2I3b', // non existing transaction
      metadata: { dummy: true }
    })
    .expect(422)

  await request(t.context.serverUrl)
    .post('/ratings')
    .set(authorizationHeaders)
    .send({
      score: 100,
      comment: 'Wonderful',
      targetId: 'usr_Y0tfQps1I3a1gJYz2I3a',
      assetId: 'ast_dmM034s1gi81giDergi8',
      transactionId: 'trn_a3BfQps1I3a1gJYz2I3a', // transaction asset doesn't match with provided asset
      metadata: { dummy: true }
    })
    .expect(422)

  t.pass()
})

test('updates a rating', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['rating:edit:all']
  })

  const { body: rating } = await request(t.context.serverUrl)
    .patch('/ratings/rtg_emdfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      score: 30,
      comment: 'Bad experience',
      metadata: { changed: true }
    })
    .expect(200)

  t.is(rating.score, 30)
  t.is(rating.comment, 'Bad experience')
  t.is(rating.targetId, 'usr_Y0tfQps1I3a1gJYz2I3a')
  t.is(rating.assetId, 'ast_0TYM7rs1OwP1gQRuCOwP')
  t.is(rating.metadata.changed, true)
  t.deepEqual(rating.metadata.existingData, [true])
})

test('removes a rating', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'rating:read:all',
      'rating:create:all',
      'rating:remove:all'
    ]
  })

  const { body: rating } = await request(t.context.serverUrl)
    .post('/ratings')
    .set(authorizationHeaders)
    .send({
      score: 100,
      assetId: 'ast_0TYM7rs1OwP1gQRuCOwP',
      comment: 'Rating to remove',
      targetId: 'usr_Y0tfQps1I3a1gJYz2I3a'
    })
    .expect(200)

  const result = await request(t.context.serverUrl)
    .delete(`/ratings/${rating.id}`)
    .set(authorizationHeaders)
    .expect(200)

  const payload = result.body

  t.is(payload.id, rating.id)

  await request(t.context.serverUrl)
    .get(`/ratings/${rating.id}`)
    .set(authorizationHeaders)
    .expect(404)

  t.pass()
})

// ////////// //
// VALIDATION //
// ////////// //

test('fails to create a rating if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .post('/ratings')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .post('/ratings')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      score: 'invalid',
      comment: true,
      authorId: true,
      targetId: true,
      label: true,
      assetId: true,
      transactionId: true,
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"score" must be a number'))
  t.true(error.message.includes('"comment" must be a string'))
  t.true(error.message.includes('"authorId" must be a string'))
  t.true(error.message.includes('"targetId" must be a string'))
  t.true(error.message.includes('"label" must be a string'))
  t.true(error.message.includes('"assetId" must be a string'))
  t.true(error.message.includes('"transactionId" must be a string'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

test('fails to update a rating if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .patch('/ratings/rtg_UEZfQps1I3a1gJYz2I3a')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .patch('/ratings/rtg_UEZfQps1I3a1gJYz2I3a')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      score: 'invalid',
      label: true,
      comment: true,
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"score" must be a number'))
  t.true(error.message.includes('"label" must be a string'))
  t.true(error.message.includes('"comment" must be a string'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

// //////// //
// VERSIONS //
// //////// //

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('2019-05-20: gets simple rating stats with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['rating:stats:all']
  })

  await checkOffsetPaginationScenario({
    t,
    endpointUrl: '/ratings/stats?groupBy=authorId',
    authorizationHeaders,
    orderBy: 'avg'
  })
})

// run this test serially because there is no filter and some other tests create events
// that can turn the check on `count` property incorrect
test.serial('2019-05-20: gets simple rating stats', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: [
      'rating:stats:all',
      'rating:list:all'
    ]
  })

  const groupBy = 'authorId'

  const { body: { results: ratings } } = await request(t.context.serverUrl)
    .get('/ratings')
    .set(authorizationHeaders)
    .expect(200)

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/ratings/stats?groupBy=${groupBy}`)
    .set(authorizationHeaders)
    .expect(200)

  checkOffsetPaginatedStatsObject({
    t,
    obj,
    groupBy,
    field: 'score', // implicit for Rating API
    avgPrecision: 0, // implicit for Rating API
    results: ratings,
    orderBy: 'avg',
    order: 'desc',
    expandedGroupByField: false
  })

  // cf. plugin middleware test below
  t.is(typeof obj.workingTestMiddleware, 'undefined')
})

// run this test serially because there is no filter and some other tests create events
// that can turn the check on `count` property incorrect
test.serial('2019-05-20: gets aggregated rating stats with ranking', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: [
      'rating:stats:all',
      'rating:list:all'
    ]
  })

  const groupBy = 'authorId'

  const { body: { results: ratings } } = await request(t.context.serverUrl)
    .get('/ratings')
    .set(authorizationHeaders)
    .expect(200)

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/ratings/stats?groupBy=${groupBy}&computeRanking=true`)
    .set(authorizationHeaders)
    .expect(200)

  let ranking

  checkOffsetPaginatedStatsObject({
    t,
    obj,
    groupBy,
    field: 'score', // implicit for Rating API
    avgPrecision: 0, // implicit for Rating API
    results: ratings,
    orderBy: 'avg',
    order: 'desc',
    expandedGroupByField: false,
    additionalResultCheckFn: (result) => {
      t.is(typeof result.ranking, 'number')
      t.is(typeof result.lowestRanking, 'number')

      t.is(result.lowestRanking, obj.nbResults) // is true because there is no filter

      // check ranking order
      if (typeof ranking === 'undefined') {
        ranking = result.ranking
      } else {
        t.true(ranking < result.ranking)
      }
    }
  })
})

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('2019-05-20: lists ratings with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['rating:list:all']
  })

  await checkOffsetPaginationScenario({
    t,
    endpointUrl: '/ratings',
    authorizationHeaders,
  })
})

test('2019-05-20: lists ratings with id filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['rating:list:all']
  })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/ratings?id=rtg_2l7fQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  checkOffsetPaginatedListObject(t, obj)
  t.is(obj.results.length, 1)
})

test('2019-05-20: lists ratings with label filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['rating:list:all']
  })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/ratings?label=main:friendliness,main:pricing')
    .set(authorizationHeaders)
    .expect(200)

  const checkResultsFn = (t, rating) => {
    t.true(['main:friendliness', 'main:pricing'].includes(rating.label))
  }

  checkOffsetPaginatedListObject(t, obj, { checkResultsFn })
})

test('2019-05-20: lists ratings with wildcard label filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['rating:list:all']
  })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/ratings?label=main:*')
    .set(authorizationHeaders)
    .expect(200)

  const checkResultsFn = (t, rating) => t.true(rating.label.startsWith('main:'))
  checkOffsetPaginatedListObject(t, obj, { checkResultsFn })
})
