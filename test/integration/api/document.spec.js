require('dotenv').config()

const test = require('ava')
const request = require('supertest')
const _ = require('lodash')

const { before, beforeEach, after } = require('../../lifecycle')
const { getAccessTokenHeaders } = require('../../auth')
const {
  checkOffsetPaginatedStatsObject,
  checkOffsetPaginationScenario,
  checkOffsetPaginatedListObject,

  checkCursorPaginatedStatsObject,
  checkCursorPaginationScenario,
  checkCursorPaginatedListObject,

  checkFilters,
} = require('../../util')

test.before(async (t) => {
  await before({ name: 'document' })(t)
  await beforeEach()(t) // concurrent tests are much faster (~6 times here)
})
// test.beforeEach(beforeEach())
test.after(after())

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('get simple documents stats with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['document:stats:all'] })

  await checkCursorPaginationScenario({
    t,
    endpointUrl: '/documents/stats?type=movie&groupBy=data.director',
    authorizationHeaders,
    orderBy: 'count'
  })
})

test('get simple documents stats', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'document:stats:all',
      'document:list:all'
    ]
  })

  const groupBy = 'data.director'
  const filters = 'type=movie'

  const { body: { results: documents } } = await request(t.context.serverUrl)
    .get(`/documents?${filters}`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/documents/stats?groupBy=${groupBy}&${filters}`)
    .set(authorizationHeaders)
    .expect(200)

  checkCursorPaginatedStatsObject({
    t,
    obj,
    groupBy,
    results: documents
  })
})

test('get aggregated field stats', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'document:stats:all',
      'document:list:all'
    ]
  })

  const groupBy = 'data.director'
  const field = 'data.score'
  const filters = 'type=movie'
  const orderBy = 'avg'
  const order = 'asc'

  const { body: { results: documents } } = await request(t.context.serverUrl)
    .get(`/documents?${filters}`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/documents/stats?groupBy=${groupBy}&field=${field}&orderBy=${orderBy}&order=${order}&${filters}`)
    .set(authorizationHeaders)
    .expect(200)

  checkCursorPaginatedStatsObject({
    t,
    obj,
    groupBy,
    field,
    results: documents,
    orderBy,
    order,
    additionalResultCheckFn: (result) => {
      t.is(typeof result.ranking, 'undefined')
      t.is(typeof result.lowestRanking, 'undefined')
    }
  })
})

test('get aggregated field stats by authorId and filter on an authorId', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'document:stats:all',
      'document:list:all'
    ]
  })

  const groupBy = 'authorId'
  const field = 'data.score'
  const filters = 'type=movie&authorId=user-external-id'
  const orderBy = 'avg'
  const order = 'asc'

  const { body: { results: documents } } = await request(t.context.serverUrl)
    .get(`/documents?${filters}`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/documents/stats?groupBy=${groupBy}&field=${field}&orderBy=${orderBy}&order=${order}&${filters}`)
    .set(authorizationHeaders)
    .expect(200)

  checkCursorPaginatedStatsObject({
    t,
    obj,
    groupBy,
    field,
    results: documents,
    orderBy,
    order,
    additionalResultCheckFn: (result) => {
      t.is(typeof result.ranking, 'undefined')
      t.is(typeof result.lowestRanking, 'undefined')
    }
  })
})

test('get aggregated field stats with ranking', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'document:stats:all',
      'document:list:all'
    ]
  })

  const groupBy = 'data.director'
  const field = 'data.score'
  const filters = 'type=movie&authorId=user-external-id'
  const orderBy = 'avg'
  const order = 'asc'

  const { body: { results: documents } } = await request(t.context.serverUrl)
    .get(`/documents?${filters}`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/documents/stats?groupBy=${groupBy}&field=${field}&orderBy=${orderBy}&order=${order}&${filters}&computeRanking=true`)
    .set(authorizationHeaders)
    .expect(200)

  let ranking
  checkCursorPaginatedStatsObject({
    t,
    obj,
    groupBy,
    field,
    results: documents,
    orderBy,
    order,
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

test('get aggregated field stats with ranking with specified label', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'document:stats:all',
      'document:list:all'
    ]
  })

  const groupBy = 'data.director'
  const field = 'data.score'
  const filters = 'type=movie&label=source:imdb'
  const orderBy = 'avg'
  const order = 'asc'

  const { body: { results: documents } } = await request(t.context.serverUrl)
    .get(`/documents?${filters}`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/documents/stats?groupBy=${groupBy}&field=${field}&orderBy=${orderBy}&order=${order}&${filters}&computeRanking=true`)
    .set(authorizationHeaders)
    .expect(200)

  let ranking
  checkCursorPaginatedStatsObject({
    t,
    obj,
    groupBy,
    field,
    results: documents,
    orderBy,
    order,
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

  const filters2 = 'type=movie&label=source:random'

  const { body: obj2 } = await request(t.context.serverUrl)
    .get(`/documents/stats?groupBy=${groupBy}&field=${field}&orderBy=${orderBy}&order=${order}&${filters2}&computeRanking=true`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(obj.results[0].avg !== obj2.results[0].avg)
})

test('get aggregated field stats with ranking with wildcard label', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['document:stats:all'] })

  const queryParamsPrefix = 'type=movie&groupBy=data.director&field=data.score&orderBy=avg&order=asc' +
  '&computeRanking=true&label=source'

  const queryParams = `${queryParamsPrefix}:imdb`

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/documents/stats?${queryParams}`)
    .set(authorizationHeaders)
    .expect(200)

  const queryParams2 = `${queryParamsPrefix}:imdb2` // TODO: allow inner wildcard (currently only ':*')

  const { body: obj2 } = await request(t.context.serverUrl)
    .get(`/documents/stats?${queryParams2}`)
    .set(authorizationHeaders)
    .expect(200)

  const queryParams3 = `${queryParamsPrefix}:random`

  const { body: obj3 } = await request(t.context.serverUrl)
    .get(`/documents/stats?${queryParams3}`)
    .set(authorizationHeaders)
    .expect(200)

  const queryParams4 = `${queryParamsPrefix}:*`

  const { body: obj4 } = await request(t.context.serverUrl)
    .get(`/documents/stats?${queryParams4}`)
    .set(authorizationHeaders)
    .expect(200)

  const getTotalCount = obj => obj.results.reduce((memo, result) => {
    return memo + result.count
  }, 0)

  t.is(getTotalCount(obj) + getTotalCount(obj2) + getTotalCount(obj3), getTotalCount(obj4))
})

test('get aggregated field stats with ranking and postranking filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'document:stats:all',
      'document:list:all'
    ]
  })

  const groupBy = 'data.director'
  const field = 'data.score'
  const filters = 'type=movie'
  const orderBy = 'avg'
  const order = 'asc'

  const { body: beforeObj } = await request(t.context.serverUrl)
    .get(`/documents/stats?groupBy=${groupBy}&field=${field}&orderBy=${orderBy}&order=${order}&${filters}&computeRanking=true`)
    .set(authorizationHeaders)
    .expect(200)

  const lowestRanking = beforeObj.results.length

  const directorRanking = beforeObj.results.reduce((memo, result) => {
    if (result.groupByValue === 'Hayao Miyazaki') {
      return result.ranking
    }
    return memo
  }, null)

  // Now only filter on the director, ranking stats should not changed
  const filters2 = 'type=movie&data[director]=Hayao+Miyazaki'

  const { body: { results: documents } } = await request(t.context.serverUrl)
    .get(`/documents?${filters2}`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/documents/stats?groupBy=${groupBy}&field=${field}&orderBy=${orderBy}&order=${order}&${filters2}&computeRanking=true`)
    .set(authorizationHeaders)
    .expect(200)

  checkCursorPaginatedStatsObject({
    t,
    obj,
    groupBy,
    field,
    results: documents,
    orderBy,
    order,
    additionalResultCheckFn: (result) => {
      t.is(typeof result.ranking, 'number')
      t.is(typeof result.lowestRanking, 'number')

      t.is(result.ranking, directorRanking)
      t.is(result.lowestRanking, lowestRanking)
    }
  })
})

test('get aggregated field stats with ranking and preranking filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'document:stats:all',
      'document:list:all'
    ]
  })

  const groupBy = 'data.director'
  const field = 'data.score'
  const filters = 'type=movie&data[composer]=Masaru+Sato'
  const orderBy = 'avg'
  const order = 'asc'

  const { body: { results: documents } } = await request(t.context.serverUrl)
    .get(`/documents?${filters}`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/documents/stats?groupBy=${groupBy}&field=${field}&orderBy=${orderBy}&order=${order}&${filters}&computeRanking=true`)
    .set(authorizationHeaders)
    .expect(200)

  checkCursorPaginatedStatsObject({
    t,
    obj,
    groupBy,
    field,
    results: documents,
    orderBy,
    order,
    additionalResultCheckFn: (result) => {
      t.is(typeof result.ranking, 'number')
      t.is(typeof result.lowestRanking, 'number')
    }
  })
})

test('get aggregated field stats with multiple labels', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['document:stats:all'] })

  const queryParams = 'type=movie&groupBy=data.director&field=data.score&orderBy=avg' +
    '&order=asc&computeRanking=true&label=source:*,source:imdb,source:random&data[director]=Hayao+Miyazaki'

  const result = await request(t.context.serverUrl)
    .get(`/documents/stats?${queryParams}`)
    .set(authorizationHeaders)
    .expect(200)

  const obj = result.body

  // do not check cursor because when wildcard labels are passed, an aggregated result is returned
  // so cursors cannot be provided
  checkCursorPaginatedListObject(t, obj, { cursorCheck: false })
  t.is(obj.results.length, 1)

  const checkStatObject = obj => {
    t.is(typeof obj, 'object')
    t.is(obj.groupBy, 'data.director')
    t.truthy(obj.groupByValue)
    t.is(typeof obj.count, 'number')
    t.is(typeof obj.sum, 'number')
    t.is(typeof obj.avg, 'number')
    t.is(typeof obj.min, 'number')
    t.is(typeof obj.max, 'number')
  }

  checkStatObject(obj.results[0]['source:*'])
  checkStatObject(obj.results[0]['source:imdb'])
  checkStatObject(obj.results[0]['source:random'])
})

test('aggregated field stats with multiple labels works if only the filter on the groupBy is unique', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['document:stats:all'] })

  const queryParams = 'type=movie&groupBy=data.director&field=data.score&orderBy=avg' +
    '&order=asc&computeRanking=true&label=source:*,source:imdb,source:random&data[director]=Hayao+Miyazaki'

  await request(t.context.serverUrl)
    .get(`/documents/stats?${queryParams}`)
    .set(authorizationHeaders)
    .expect(200)

  const queryParams2 = 'type=movie&groupBy=data.director&field=data.score&orderBy=avg' +
    '&order=asc&computeRanking=true&label=source:*,source:imdb,source:random' +
    '&data[director]=Hayao+Miyazaki,Akira+Kurosawa'

  await request(t.context.serverUrl)
    .get(`/documents/stats?${queryParams2}`)
    .set(authorizationHeaders)
    .expect(422)

  t.pass()
})

test('aggregated field stats with multiple labels on a non-existing label returns an empty stats object', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['document:stats:all'] })

  const queryParams = 'type=movie&groupBy=data.director&field=data.score&orderBy=avg' +
    '&order=asc&computeRanking=true&label=source:*,source:hello&data[director]=Hayao+Miyazaki'

  const result = await request(t.context.serverUrl)
    .get(`/documents/stats?${queryParams}`)
    .set(authorizationHeaders)
    .expect(200)

  const obj = result.body

  const emptyStatsObject = obj.results[0]['source:hello']

  t.is(emptyStatsObject.groupBy, 'data.director')
  t.is(emptyStatsObject.groupByValue, null)
  t.is(emptyStatsObject.count, 0)
  t.is(emptyStatsObject.sum, null)
  t.is(emptyStatsObject.avg, null)
  t.is(emptyStatsObject.min, null)
  t.is(emptyStatsObject.max, null)
})

test('get aggregated field stats with average rounded to integer', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['document:stats:all'] })

  const isInteger = (value) => !isNaN(value) && Math.round(value) === value

  const result1 = await request(t.context.serverUrl)
    .get('/documents/stats?type=movie&groupBy=data.director&field=data.score&orderBy=min&order=asc&avgPrecision=5')
    .set(authorizationHeaders)
    .expect(200)

  const obj1 = result1.body

  obj1.results.forEach(result1 => {
    t.false(isInteger(result1.avg)) // score is decimal, it's highly probable to get a decimal number as average
  })

  const result2 = await request(t.context.serverUrl)
    .get('/documents/stats?type=movie&groupBy=data.director&field=data.score&orderBy=min&order=asc&avgPrecision=0')
    .set(authorizationHeaders)
    .expect(200)

  const obj2 = result2.body

  obj2.results.forEach(result2 => {
    t.true(isInteger(result2.avg))
  })
})

test('fails to get aggregated stats with non-number field', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['document:stats:all'] })

  const groupBy = 'authorId'
  const field = 'data.title'

  const { body: error } = await request(t.context.serverUrl)
    .get(`/documents/stats?type=movie&groupBy=${groupBy}&field=${field}`)
    .set(authorizationHeaders)
    .expect(422)

  t.true(error.message.includes(`Non-number value was found for field "${field}"`))
})

// use serial because no changes must be made during the check
test.serial('check history filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'document:stats:all',
      'document:list:all',
    ]
  })

  const groupBys = [
    'authorId', // document first-level property
    'data.director', // document data sub-property
  ]

  for (const groupBy of groupBys) {
    const { body: { results } } = await request(t.context.serverUrl)
      .get('/documents?nbResultsPerPage=100&type=movie')
      .set(authorizationHeaders)
      .expect(200)

    const resultsByGroupBy = _.groupBy(results, groupBy)

    const customExactValueCheck = _.curry((prop, obj, value) => {
      let filteredResults = resultsByGroupBy[obj.groupByValue] || []
      filteredResults = filteredResults.filter(r => r[prop] === value)
      return filteredResults.length === obj.count
    })

    const customArrayValuesCheck = _.curry((prop, obj, values) => {
      let filteredResults = resultsByGroupBy[obj.groupByValue] || []
      filteredResults = filteredResults.filter(r => values.includes(r[prop]))
      return filteredResults.length === obj.count
    })

    await checkFilters({
      t,
      endpointUrl: `/documents/stats?groupBy=${groupBy}&type=movie`,
      fetchEndpointUrl: '/documents?type=movie',
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
          prop: 'label',
          // multiple labels filter on stats are tested on other tests
          customExactValueFilterCheck: customExactValueCheck('label'),
        },
        // `data` is tested in other tests
      ],
    })
  }
})

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('list documents with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['document:list:all'] })

  await checkCursorPaginationScenario({
    t,
    endpointUrl: '/documents?type=invoice',
    authorizationHeaders,
  })
})

// use serial because no changes must be made during the check
test.serial('check list filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['document:list:all'] })

  await checkFilters({
    t,
    endpointUrl: '/documents?type=invoice',
    authorizationHeaders,
    checkPaginationObject: checkCursorPaginatedListObject,

    filters: [
      {
        prop: 'id',
        isArrayFilter: true,
      },
      {
        prop: 'label',
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
      // `data` is tested in other tests
    ],
  })
})

test('list documents with advanced filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['document:list:all'] })

  const result1 = await request(t.context.serverUrl)
    .get('/documents?type=invoice&id=doc_WWRfQps1I3a1gJYz2I3a,user-external-id')
    .set(authorizationHeaders)
    .expect(200)

  const obj1 = result1.body

  obj1.results.forEach(doc => {
    t.true(['doc_WWRfQps1I3a1gJYz2I3a', 'user-external-id'].includes(doc.authorId))
  })

  const result2 = await request(t.context.serverUrl)
    .get('/documents?type=invoice&data[invoiceUrl]=https://example.com/invoice')
    .set(authorizationHeaders)
    .expect(200)

  const obj2 = result2.body

  obj2.results.forEach(doc => {
    t.true(['https://example.com/invoice'].includes(doc.data.invoiceUrl))
  })
})

test('list documents with data object filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['document:list:all'] })

  const encode = obj => encodeURIComponent(JSON.stringify(obj))

  const { body: castleInTheSky } = await request(t.context.serverUrl)
    .get('/documents?type=movie&data[title]=Castle+in+the+Sky')
    .set(authorizationHeaders)
    .expect(200)

  t.truthy(castleInTheSky.results.length)
  castleInTheSky.results.forEach(doc => {
    t.is(_.get(doc.data, 'title'), 'Castle in the Sky')
  })

  const { body: notAwesome } = await request(t.context.serverUrl)
    .get('/documents?type=movie&data[tags][awesome]=true') // parsed as a string
    .set(authorizationHeaders)
    .expect(200)

  t.falsy(notAwesome.results.length)

  const { body: awesome } = await request(t.context.serverUrl)
    .get(`/documents?type=movie&data=${encode({ tags: { awesome: true } })}`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(awesome.results.length > 1)
  awesome.results.forEach(doc => {
    t.true(_.get(doc.data, 'tags.awesome'))
  })

  const { body: nothing } = await request(t.context.serverUrl)
    .get('/documents?type=movie&data[tags][timesSeen]=10') // parsed as a string
    .set(authorizationHeaders)
    .expect(200)

  t.falsy(nothing.results.length)

  const { body: seenTenTimes } = await request(t.context.serverUrl)
    .get(`/documents?type=movie&data=${encode({ tags: { timesSeen: 10 } })}`)
    .set(authorizationHeaders)
    .expect(200)

  t.truthy(seenTenTimes.results.length)
  seenTenTimes.results.forEach(doc => {
    t.is(_.get(doc.data, 'tags.timesSeen'), 10)
  })

  const { body: complexQuery } = await request(t.context.serverUrl)
    .get(`/documents?type=movie&data=${encode({
      tags: {
        awesome: true,
        timesSeen: 10,
        heroes: ['Sheeta']
      }
    })}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(complexQuery.results.length, 1)
  const doc = complexQuery.results[0]
  t.true(_.get(doc.data, 'tags.awesome'))
  t.is(_.get(doc.data, 'tags.timesSeen'), 10)
  t.true(Array.isArray(_.get(doc.data, 'tags.heroes')))
  t.true(doc.data.tags.heroes.includes('Sheeta'))

  const { body: noHit } = await request(t.context.serverUrl)
    .get(`/documents?type=movie&data=${encode({
      tags: {
        awesome: true,
        timesSeen: 10,
        heroes: ['Unknown']
      }
    })}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(noHit.results.length, 0)
})

test('list documents with label filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['document:list:all'] })

  const result1 = await request(t.context.serverUrl)
    .get('/documents?type=blogpost')
    .set(authorizationHeaders)
    .expect(200)

  const obj1 = result1.body

  const result2 = await request(t.context.serverUrl)
    .get('/documents?type=blogpost&label=*')
    .set(authorizationHeaders)
    .expect(200)

  const obj2 = result2.body

  t.is(obj1.nbResults, obj2.nbResults)

  const result3 = await request(t.context.serverUrl)
    .get('/documents?type=blogpost&label=main:popular')
    .set(authorizationHeaders)
    .expect(200)

  const obj3 = result3.body

  t.true(obj3.results.length > 0)
  obj3.results.forEach(result => {
    t.is(result.label, 'main:popular')
  })

  const result4 = await request(t.context.serverUrl)
    .get('/documents?type=blogpost&label=main:popular,main:random')
    .set(authorizationHeaders)
    .expect(200)

  const obj4 = result4.body

  t.true(obj4.results.length > 0)
  obj4.results.forEach(result => {
    t.true(['main:popular', 'main:random'].includes(result.label))
  })

  const result5 = await request(t.context.serverUrl)
    .get('/documents?type=blogpost&label=main:*')
    .set(authorizationHeaders)
    .expect(200)

  const obj5 = result5.body

  t.true(obj5.results.length > 0)
  obj5.results.forEach(result => {
    t.true(result.label.startsWith('main:'))
  })
})

test('finds a document', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['document:read:all'] })

  const { body: document } = await request(t.context.serverUrl)
    .get('/documents/doc_WWRfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  t.is(document.id, 'doc_WWRfQps1I3a1gJYz2I3a')
  t.is(document.type, 'invoice')
})

test('creates a document', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'document:create:all',
      'platformData:edit:all'
    ]
  })

  const data = {
    title: 'The most beautiful car I have ever seen',
    content: 'I do not know how I can describe it',
    assetId: 'ast_2l7fQps1I3a1gJYz2I3a'
  }

  const { body: document } = await request(t.context.serverUrl)
    .post('/documents')
    .set(authorizationHeaders)
    .send({
      type: 'blogpost:car',
      data,
      metadata: {
        metadataField: true
      },
      platformData: {
        platformDataField: true
      }
    })
    .expect(200)

  t.is(document.label, null)
  t.deepEqual(document.data, data)
  t.deepEqual(document.metadata, { metadataField: true })
  t.deepEqual(document.platformData, { platformDataField: true })
})

// .serial makes counting easier
test.serial('updates a document with platformData', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'document:edit:all',
      'platformData:edit:all'
    ]
  })

  const { body: document } = await request(t.context.serverUrl)
    .patch('/documents/doc_g29VxDs1DEa1gEk9KDEa')
    .set(authorizationHeaders)
    .send({
      label: 'source:imdb2',
      data: {
        score: 20
      },
      metadata: { dummy: true },
      platformData: { isAwesome: true }
    })
    .expect(200)

  t.is(document.id, 'doc_g29VxDs1DEa1gEk9KDEa')
  t.is(document.label, 'source:imdb2')
  t.is(document.data.title, 'Castle in the Sky')
  t.is(document.data.director, 'Hayao Miyazaki')
  t.is(document.data.composer, 'Joe Hisaishi')
  t.is(document.data.score, 20)
  t.is(document.type, 'movie')
  t.deepEqual(document.platformData, { isAwesome: true })
})

test('updates a document with replacement of some properties', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'document:create:all',
      'document:edit:all',
      'platformData:edit:all'
    ]
  })

  const data = {
    randomText: 'hello',
    nestedObjectWithReplacement: { color: 'blue' },
    nestedObjectWithoutReplacement: { color: 'red' }
  }

  const { body: document } = await request(t.context.serverUrl)
    .post('/documents')
    .set(authorizationHeaders)
    .send({
      type: 'testReplacement',
      data,
      metadata: { metadataField: true },
      platformData: { platformDataField: true }
    })
    .expect(200)

  t.is(document.label, null)
  t.deepEqual(document.data, data)
  t.deepEqual(document.metadata, { metadataField: true })
  t.deepEqual(document.platformData, { platformDataField: true })

  const { body: newDocument } = await request(t.context.serverUrl)
    .patch(`/documents/${document.id}`)
    .set(authorizationHeaders)
    .send({
      data: {
        nestedObjectWithReplacement: { replaced: true },
        nestedObjectWithoutReplacement: { replaced: false }
      },
      replaceDataProperties: ['nestedObjectWithReplacement']
    })

  t.deepEqual(newDocument.data.nestedObjectWithReplacement, { replaced: true }) // properties replaced
  t.deepEqual(newDocument.data.nestedObjectWithoutReplacement, { color: 'red', replaced: false }) // properties merged
})

// .serial makes counting easier
test.serial('removes a document', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'document:read:all',
      'document:create:all',
      'document:remove:all'
    ]
  })

  const { body: document } = await request(t.context.serverUrl)
    .post('/documents')
    .set(authorizationHeaders)
    .send({
      type: 'Document to remove'
    })
    .expect(200)

  const result = await request(t.context.serverUrl)
    .delete(`/documents/${document.id}`)
    .set(authorizationHeaders)
    .expect(200)

  const payload = result.body

  t.is(payload.id, document.id)

  await request(t.context.serverUrl)
    .get(`/documents/${document.id}`)
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
    .post('/documents')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // missing required parameters
  result = await request(t.context.serverUrl)
    .post('/documents')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({})
    .expect(400)

  error = result.body
  t.true(error.message.includes('"type" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .post('/documents')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      authorId: true,
      targetId: true,
      type: true,
      label: true,
      data: true,
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"authorId" must be a string'))
  t.true(error.message.includes('"targetId" must be a string'))
  t.true(error.message.includes('"type" must be a string'))
  t.true(error.message.includes('"label" must be a string'))
  t.true(error.message.includes('"data" must be of type object'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

test('fails to update a document if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .patch('/documents/doc_WWRfQps1I3a1gJYz2I3a')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .patch('/documents/doc_WWRfQps1I3a1gJYz2I3a')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      label: true,
      data: true,
      metadata: true,
      platformData: true,

      replaceDataProperties: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"label" must be a string'))
  t.true(error.message.includes('"data" must be of type object'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
  t.true(error.message.includes('"replaceDataProperties" must be an array'))
})

// //////// //
// VERSIONS //
// //////// //

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('2019-05-20: get simple documents stats with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['document:stats:all']
  })

  await checkOffsetPaginationScenario({
    t,
    endpointUrl: '/documents/stats?type=movie&groupBy=data.director',
    authorizationHeaders,
    orderBy: 'count'
  })
})

test('2019-05-20: get simple documents stats', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: [
      'document:stats:all',
      'document:list:all'
    ]
  })

  const groupBy = 'data.director'
  const filters = 'type=movie'

  const { body: { results: documents } } = await request(t.context.serverUrl)
    .get(`/documents?${filters}`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/documents/stats?groupBy=${groupBy}&${filters}`)
    .set(authorizationHeaders)
    .expect(200)

  checkOffsetPaginatedStatsObject({
    t,
    obj,
    groupBy,
    results: documents
  })
})

test('2019-05-20: get aggregated field stats', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: [
      'document:stats:all',
      'document:list:all'
    ]
  })

  const groupBy = 'data.director'
  const field = 'data.score'
  const filters = 'type=movie'
  const orderBy = 'avg'
  const order = 'asc'

  const { body: { results: documents } } = await request(t.context.serverUrl)
    .get(`/documents?${filters}`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/documents/stats?groupBy=${groupBy}&field=${field}&orderBy=${orderBy}&order=${order}&${filters}`)
    .set(authorizationHeaders)
    .expect(200)

  checkOffsetPaginatedStatsObject({
    t,
    obj,
    groupBy,
    field,
    results: documents,
    orderBy,
    order,
    additionalResultCheckFn: (result) => {
      t.is(typeof result.ranking, 'undefined')
      t.is(typeof result.lowestRanking, 'undefined')
    }
  })
})

test('2019-05-20: get aggregated field stats by authorId and filter on an authorId', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: [
      'document:stats:all',
      'document:list:all'
    ]
  })

  const groupBy = 'authorId'
  const field = 'data.score'
  const filters = 'type=movie&authorId=user-external-id'
  const orderBy = 'avg'
  const order = 'asc'

  const { body: { results: documents } } = await request(t.context.serverUrl)
    .get(`/documents?${filters}`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/documents/stats?groupBy=${groupBy}&field=${field}&orderBy=${orderBy}&order=${order}&${filters}`)
    .set(authorizationHeaders)
    .expect(200)

  checkOffsetPaginatedStatsObject({
    t,
    obj,
    groupBy,
    field,
    results: documents,
    orderBy,
    order,
    additionalResultCheckFn: (result) => {
      t.is(typeof result.ranking, 'undefined')
      t.is(typeof result.lowestRanking, 'undefined')
    }
  })
})

test('2019-05-20: get aggregated field stats with ranking', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: [
      'document:stats:all',
      'document:list:all'
    ]
  })

  const groupBy = 'data.director'
  const field = 'data.score'
  const filters = 'type=movie&authorId=user-external-id'
  const orderBy = 'avg'
  const order = 'asc'

  const { body: { results: documents } } = await request(t.context.serverUrl)
    .get(`/documents?${filters}`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/documents/stats?groupBy=${groupBy}&field=${field}&orderBy=${orderBy}&order=${order}&${filters}&computeRanking=true`)
    .set(authorizationHeaders)
    .expect(200)

  let ranking
  checkOffsetPaginatedStatsObject({
    t,
    obj,
    groupBy,
    field,
    results: documents,
    orderBy,
    order,
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

test('2019-05-20: get aggregated field stats with ranking with specified label', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: [
      'document:stats:all',
      'document:list:all'
    ]
  })

  const groupBy = 'data.director'
  const field = 'data.score'
  const filters = 'type=movie&label=source:imdb'
  const orderBy = 'avg'
  const order = 'asc'

  const { body: { results: documents } } = await request(t.context.serverUrl)
    .get(`/documents?${filters}`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/documents/stats?groupBy=${groupBy}&field=${field}&orderBy=${orderBy}&order=${order}&${filters}&computeRanking=true`)
    .set(authorizationHeaders)
    .expect(200)

  let ranking
  checkOffsetPaginatedStatsObject({
    t,
    obj,
    groupBy,
    field,
    results: documents,
    orderBy,
    order,
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

  const filters2 = 'type=movie&label=source:random'

  const { body: obj2 } = await request(t.context.serverUrl)
    .get(`/documents/stats?groupBy=${groupBy}&field=${field}&orderBy=${orderBy}&order=${order}&${filters2}&computeRanking=true`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(obj.results[0].avg !== obj2.results[0].avg)
})

test('2019-05-20: get aggregated field stats with ranking and postranking filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: [
      'document:stats:all',
      'document:list:all'
    ]
  })

  const groupBy = 'data.director'
  const field = 'data.score'
  const filters = 'type=movie'
  const orderBy = 'avg'
  const order = 'asc'

  const { body: beforeObj } = await request(t.context.serverUrl)
    .get(`/documents/stats?groupBy=${groupBy}&field=${field}&orderBy=${orderBy}&order=${order}&${filters}&computeRanking=true`)
    .set(authorizationHeaders)
    .expect(200)

  const lowestRanking = beforeObj.nbResults

  const directorRanking = beforeObj.results.reduce((memo, result) => {
    if (result.groupByValue === 'Hayao Miyazaki') {
      return result.ranking
    }
    return memo
  }, null)

  // Now only filter on the director, ranking stats should not changed
  const filters2 = 'type=movie&data[director]=Hayao+Miyazaki'

  const { body: { results: documents } } = await request(t.context.serverUrl)
    .get(`/documents?${filters2}`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/documents/stats?groupBy=${groupBy}&field=${field}&orderBy=${orderBy}&order=${order}&${filters2}&computeRanking=true`)
    .set(authorizationHeaders)
    .expect(200)

  checkOffsetPaginatedStatsObject({
    t,
    obj,
    groupBy,
    field,
    results: documents,
    orderBy,
    order,
    additionalResultCheckFn: (result) => {
      t.is(typeof result.ranking, 'number')
      t.is(typeof result.lowestRanking, 'number')

      t.is(result.ranking, directorRanking)
      t.is(result.lowestRanking, lowestRanking)
    }
  })
})

test('2019-05-20: get aggregated field stats with ranking and preranking filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: [
      'document:stats:all',
      'document:list:all'
    ]
  })

  const groupBy = 'data.director'
  const field = 'data.score'
  const filters = 'type=movie&data[composer]=Masaru+Sato'
  const orderBy = 'avg'
  const order = 'asc'

  const { body: { results: documents } } = await request(t.context.serverUrl)
    .get(`/documents?${filters}`)
    .set(authorizationHeaders)
    .expect(200)

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/documents/stats?groupBy=${groupBy}&field=${field}&orderBy=${orderBy}&order=${order}&${filters}&computeRanking=true`)
    .set(authorizationHeaders)
    .expect(200)

  t.true(typeof obj === 'object')
  t.true(typeof obj.nbResults === 'number')
  t.true(typeof obj.nbPages === 'number')
  t.true(typeof obj.page === 'number')
  t.true(typeof obj.nbResultsPerPage === 'number')
  t.true(Array.isArray(obj.results))

  checkOffsetPaginatedStatsObject({
    t,
    obj,
    groupBy,
    field,
    results: documents,
    orderBy,
    order,
    additionalResultCheckFn: (result) => {
      t.is(typeof result.ranking, 'number')
      t.is(typeof result.lowestRanking, 'number')
    }
  })
})

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('2019-05-20: list documents with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['document:list:all']
  })

  await checkOffsetPaginationScenario({
    t,
    endpointUrl: '/documents?type=invoice',
    authorizationHeaders,
  })
})

test('2019-05-20: list documents with id filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['document:list:all']
  })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/documents?type=invoice&id=doc_WWRfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  checkOffsetPaginatedListObject(t, obj)
  t.is(obj.nbResults, 1)
})
