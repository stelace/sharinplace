require('dotenv').config()

const test = require('ava')
const request = require('supertest')
const _ = require('lodash')

const { before, beforeEach, after } = require('../../lifecycle')
const { getAccessTokenHeaders } = require('../../auth')

const { getModels } = require('../../../src/models')
const {
  computeDate,

  checkOffsetPaginationScenario,
  checkOffsetPaginatedListObject,

  checkCursorPaginationScenario,
  checkCursorPaginatedListObject,

  checkFilters,
} = require('../../util')
const { getObjectEvent, testEventMetadata } = require('../../util')

test.before(async t => {
  await before({ name: 'transaction' })(t)
  await beforeEach()(t)
})
// test.beforeEach(beforeEach()) // Concurrent tests are much faster
test.after(after())

const timeoutForTransactionsCancellation = () => {
  return new Promise(resolve => setTimeout(resolve, 5000))
}

const createEmptyTransaction = async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['transaction:create:all'] })

  const { body: transaction } = await request(t.context.serverUrl)
    .post('/transactions')
    .set(authorizationHeaders)
    .send({
      takerId: 'ff4bf0dd-b1d9-49c9-8c61-3e3baa04181c'
    })
    .expect(200)

  return transaction
}

let nbCreatedTransactionsWithAsset = 0

const createTransactionWithAsset = async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['transaction:create:all'] })

  const now = new Date().toISOString()

  const startDate = computeDate(now, (nbCreatedTransactionsWithAsset + 1) * 5 + ' days')
  nbCreatedTransactionsWithAsset += 1

  const { body: transaction } = await request(t.context.serverUrl)
    .post('/transactions')
    .set(authorizationHeaders)
    .send({
      assetId: 'ast_0KAm3He1ze11iSSR4ze0',
      takerId: 'ff4bf0dd-b1d9-49c9-8c61-3e3baa04181c',
      startDate,
      duration: { d: 5 }
    })
    .expect(200)

  return transaction
}

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('list transactions with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['transaction:list:all'] })

  await checkCursorPaginationScenario({
    t,
    endpointUrl: '/transactions',
    authorizationHeaders,
  })
})

test('list transactions for the current user', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:list'],
    userId: '7308ffc8-a046-4965-bb4a-b1184a42325c'
  })

  await request(t.context.serverUrl)
    .get('/transactions')
    .set(authorizationHeaders)
    .expect(403)

  await request(t.context.serverUrl)
    .get('/transactions?ownerId=user_QVQzajA5ZnMxgYbWM930qpyvKyRHMxJ,user-external-id')
    .set(authorizationHeaders)
    .expect(403)

  await request(t.context.serverUrl)
    .get('/transactions?ownerId=7308ffc8-a046-4965-bb4a-b1184a42325c')
    .set(authorizationHeaders)
    .expect(200)

  await request(t.context.serverUrl)
    .get('/transactions?takerId=7308ffc8-a046-4965-bb4a-b1184a42325c')
    .set(authorizationHeaders)
    .expect(200)

  await request(t.context.serverUrl)
    .get('/transactions?ownerId=7308ffc8-a046-4965-bb4a-b1184a42325c&takerId=user_QVQzajA5ZnMxgYbWM930qpyvKyRHMxJ,user-external-id')
    .set(authorizationHeaders)
    .expect(200)

  t.pass()
})

// use serial because no changes must be made during the check
test.serial('check list filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['transaction:list:all'] })

  await checkFilters({
    t,
    endpointUrl: '/transactions',
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
        prop: 'assetId',
        isArrayFilter: true,
      },
      {
        prop: 'assetTypeId',
        isArrayFilter: true,
      },
      {
        prop: 'ownerId',
        isArrayFilter: true,
      },
      {
        prop: 'takerId',
        isArrayFilter: true,
      },
      {
        prop: 'value',
        isRangeFilter: true,
      },
      {
        prop: 'ownerAmount',
        isRangeFilter: true,
      },
      {
        prop: 'takerAmount',
        isRangeFilter: true,
      },
      {
        prop: 'platformAmount',
        isRangeFilter: true,
      },
    ],
  })
})

test('list transactions with pricing filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['transaction:list:all'] })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/transactions?ownerAmount[lte]=500&platformAmount[gt]=10')
    .set(authorizationHeaders)
    .expect(200)

  const checkResultsFn = (t, transaction) => {
    t.true(transaction.ownerAmount <= 500)
    t.true(transaction.platformAmount > 10)
  }

  checkCursorPaginatedListObject(t, obj, { checkResultsFn })
  t.true(obj.results.length > 0)
})

test('previews a transaction', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:preview:all'],
    userId: 'user-external-id' // asset owner can preview her own asset
  })

  const now = new Date().toISOString()
  const startDate = computeDate(now, '10 days')

  const result = await request(t.context.serverUrl)
    .post('/transactions/preview')
    .set(authorizationHeaders)
    .send({
      assetId: 'ast_0KAm3He1ze11iSSR4ze0',
      startDate,
      duration: { d: 3 },
      quantity: 1,
      metadata: { dummy: true }
    })
    .expect(200)

  const transaction = result.body

  t.falsy(transaction.id)
  t.is(transaction.startDate, startDate)
  t.is(transaction.endDate, computeDate(startDate, '3 days'))
  t.is(transaction.quantity, 1)
  t.deepEqual(transaction.duration, { d: 3 })
  t.is(transaction.assetId, 'ast_0KAm3He1ze11iSSR4ze0')
  t.falsy(transaction.takerId)
  t.is(transaction.value, 600)
  t.is(transaction.ownerAmount, 570)
  t.is(transaction.takerAmount, 690)
  t.is(transaction.platformAmount, 120)
  t.is(transaction.metadata.dummy, true)
})

test('creates a transaction', async (t) => {
  // use a different user because the owner cannot book her own asset
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:create:all'],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178'
  })

  const now = new Date().toISOString()
  const startDate = computeDate(now, '10 days')

  const result = await request(t.context.serverUrl)
    .post('/transactions')
    .set(authorizationHeaders)
    .send({
      assetId: 'ast_0KAm3He1ze11iSSR4ze0',
      startDate,
      duration: { d: 3 },
      quantity: 1,
      metadata: { dummy: true }
    })
    .expect(200)

  const transaction = result.body

  t.truthy(transaction.id)
  t.is(transaction.startDate, startDate)
  t.is(transaction.endDate, computeDate(startDate, '3 days'))
  t.is(transaction.quantity, 1)
  t.deepEqual(transaction.duration, { d: 3 })
  t.is(transaction.assetId, 'ast_0KAm3He1ze11iSSR4ze0')
  t.is(transaction.takerId, 'c12ca46b-995c-487c-a940-d9e41e0ff178')
  t.is(typeof transaction.value, 'number')
  t.is(typeof transaction.ownerAmount, 'number')
  t.is(typeof transaction.takerAmount, 'number')
  t.is(typeof transaction.platformAmount, 'number')
  t.is(transaction.metadata.dummy, true)
})

// the asset is available thanks to the relative positive quantity for the associated availability
test('creates a transaction on a zero quantity asset', async (t) => {
  // use a different user because the owner cannot book her own asset
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:create:all'],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178'
  })

  const now = new Date().toISOString()
  const startDate = computeDate(now, '2 days')

  const result = await request(t.context.serverUrl)
    .post('/transactions')
    .set(authorizationHeaders)
    .send({
      assetId: 'ast_g29VxDs1DEa1gEk9KDEa',
      startDate,
      duration: { d: 1 },
      quantity: 1,
      metadata: { dummy: true }
    })
    .expect(200)

  const transaction = result.body

  t.is(transaction.startDate, startDate)
  t.is(transaction.endDate, computeDate(startDate, '1 day'))
  t.is(transaction.quantity, 1)
  t.deepEqual(transaction.duration, { d: 1 })
  t.is(transaction.assetId, 'ast_g29VxDs1DEa1gEk9KDEa')
  t.is(typeof transaction.value, 'number')
  t.is(typeof transaction.ownerAmount, 'number')
  t.is(typeof transaction.takerAmount, 'number')
  t.is(typeof transaction.platformAmount, 'number')
  t.is(transaction.metadata.dummy, true)
})

test('creates a time based transaction without end date or duration', async (t) => {
  // use a different user because the owner cannot book her own asset
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:create:all'],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178'
  })

  const now = new Date().toISOString()
  const startDate = computeDate(now, '2 days')

  const result = await request(t.context.serverUrl)
    .post('/transactions')
    .set(authorizationHeaders)
    .send({
      assetId: 'ast_g29VxDs1DEa1gEk9KDEa',
      startDate,
      quantity: 1,
      metadata: { dummy: true }
    })
    .expect(200)

  const transaction = result.body

  t.is(transaction.startDate, startDate)
  t.is(transaction.endDate, null)
  t.is(transaction.duration, null)
  t.is(transaction.quantity, 1)
  t.is(transaction.assetId, 'ast_g29VxDs1DEa1gEk9KDEa')
  t.is(typeof transaction.value, 'number')
  t.is(typeof transaction.ownerAmount, 'number')
  t.is(typeof transaction.takerAmount, 'number')
  t.is(typeof transaction.platformAmount, 'number')
  t.is(transaction.metadata.dummy, true)
})

test('fails to create a transaction on an asset that is not active or not validated', async (t) => {
  // use a different user because the owner cannot book her own asset
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:create:all'],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178'
  })

  const now = new Date().toISOString()
  const startDate = computeDate(now, '2 days')

  await request(t.context.serverUrl)
    .post('/transactions')
    .set(authorizationHeaders)
    .send({
      assetId: 'ast_2l7fQps1I3a1gJYz2I3a',
      startDate,
      duration: { d: 4 },
      quantity: 1,
      metadata: { dummy: true }
    })
    .expect(422)

  t.pass()
})

test('fails to create a transaction due to asset unavailability', async (t) => {
  // use a different user because the owner cannot book her own asset
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:create:all'],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178'
  })

  const now = new Date().toISOString()
  const startDate = computeDate(now, '2 days')

  await request(t.context.serverUrl)
    .post('/transactions')
    .set(authorizationHeaders)
    .send({
      assetId: 'ast_0TYM7rs1OwP1gQRuCOwP',
      startDate,
      duration: { d: 4 },
      quantity: 1,
      metadata: { dummy: true }
    })
    .expect(422)

  t.pass()
})

test('creates a transaction without any information besides the taker', async (t) => {
  // use a different user because the owner cannot book her own asset
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:create:all'],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178'
  })

  const result = await request(t.context.serverUrl)
    .post('/transactions')
    .set(authorizationHeaders)
    .send({
      metadata: { dummy: true }
    })
    .expect(200)

  const transaction = result.body

  t.is(transaction.startDate, null)
  t.is(transaction.quantity, 1)
  t.deepEqual(transaction.duration, null)
  t.is(transaction.assetId, null)
  t.is(transaction.value, null)
  t.is(transaction.ownerAmount, null)
  t.is(transaction.takerAmount, null)
  t.is(transaction.platformAmount, null)
  t.is(transaction.metadata.dummy, true)
})

test('creates a transaction without assigning an asset', async (t) => {
  // use a different user because the owner cannot book her own asset
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:create:all'],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178'
  })

  const now = new Date().toISOString()
  const startDate = computeDate(now, '10 days')

  const result = await request(t.context.serverUrl)
    .post('/transactions')
    .set(authorizationHeaders)
    .send({
      startDate,
      duration: { d: 3 },
      quantity: 1,
      metadata: { dummy: true }
    })
    .expect(200)

  const transaction = result.body

  t.is(transaction.startDate, startDate)
  t.is(transaction.endDate, computeDate(startDate, '3 days'))
  t.is(transaction.quantity, 1)
  t.deepEqual(transaction.duration, { d: 3 })
  t.is(transaction.assetId, null)
  t.is(transaction.value, null)
  t.is(transaction.ownerAmount, null)
  t.is(transaction.takerAmount, null)
  t.is(transaction.platformAmount, null)
  t.is(transaction.metadata.dummy, true)
})

test('creates a transaction by specifying the end date', async (t) => {
  // use a different user because the owner cannot book her own asset
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:create:all'],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178'
  })

  const now = new Date().toISOString()
  const startDate = computeDate(now, '10 days')
  const endDate = computeDate(now, '13 days')

  const result = await request(t.context.serverUrl)
    .post('/transactions')
    .set(authorizationHeaders)
    .send({
      startDate,
      endDate,
      quantity: 1,
      metadata: { dummy: true }
    })
    .expect(200)

  const transaction = result.body

  t.is(transaction.startDate, startDate)
  t.is(transaction.endDate, endDate)
  t.is(transaction.quantity, 1)
  t.deepEqual(transaction.duration, { d: 3 })
  t.is(transaction.assetId, null)
  t.is(transaction.value, null)
  t.is(transaction.ownerAmount, null)
  t.is(transaction.takerAmount, null)
  t.is(transaction.platformAmount, null)
  t.is(transaction.metadata.dummy, true)
})

test('creates a transaction on an asset that does not have an owner', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'transaction:create:all',
      'asset:create:all'
    ],
    userId: null
  })

  const now = new Date().toISOString()
  const startDate = computeDate(now, '10 days')

  const { body: asset } = await request(t.context.serverUrl)
    .post('/assets')
    .set(authorizationHeaders)
    .send({
      name: 'Nissan',
      currency: 'USD',
    })

  const { body: transaction } = await request(t.context.serverUrl)
    .post('/transactions')
    .set(authorizationHeaders)
    .send({
      assetId: asset.id,
      takerId: 'external-user-id',
      startDate,
      duration: { d: 3 },
      quantity: 1,
      metadata: { dummy: true }
    })
    .expect(200)

  t.is(transaction.startDate, startDate)
  t.is(transaction.endDate, computeDate(startDate, '3 days'))
  t.is(transaction.quantity, 1)
  t.deepEqual(transaction.duration, { d: 3 })
  t.is(transaction.assetId, asset.id)
  t.is(typeof transaction.value, 'number')
  t.is(typeof transaction.ownerAmount, 'number')
  t.is(typeof transaction.takerAmount, 'number')
  t.is(typeof transaction.platformAmount, 'number')
  t.is(transaction.metadata.dummy, true)
})

test('creates a transaction by specifying pricing', async (t) => {
  // use a different user because the owner cannot book her own asset
  const notEnoughPermissionsAuthorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:create:all'],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178'
  })
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'transaction:create:all',
      'transaction:config:all'
    ],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178'
  })

  const now = new Date().toISOString()
  const startDate = computeDate(now, '10 days')

  await request(t.context.serverUrl)
    .post('/transactions')
    .set(notEnoughPermissionsAuthorizationHeaders)
    .send({
      assetId: 'ast_0KAm3He1ze11iSSR4ze0',
      startDate,
      duration: { d: 3 },
      quantity: 1,
      value: 500,
      metadata: { dummy: true }
    })
    .expect(403)

  const { body: transaction1 } = await request(t.context.serverUrl)
    .post('/transactions')
    .set(authorizationHeaders)
    .send({
      assetId: 'ast_0KAm3He1ze11iSSR4ze0',
      startDate,
      duration: { d: 3 },
      quantity: 1,
      value: 500,
      metadata: { dummy: true }
    })
    .expect(200)

  t.is(transaction1.startDate, startDate)
  t.is(transaction1.endDate, computeDate(startDate, '3 days'))
  t.is(transaction1.quantity, 1)
  t.deepEqual(transaction1.duration, { d: 3 })
  t.is(transaction1.assetId, 'ast_0KAm3He1ze11iSSR4ze0')
  t.is(transaction1.value, 500)
  t.is(transaction1.ownerAmount, 475) // computed via passed value
  t.is(transaction1.takerAmount, 575) // computed via passed value
  t.is(transaction1.platformAmount, 100)
  t.is(transaction1.metadata.dummy, true)

  const { body: transaction2 } = await request(t.context.serverUrl)
    .post('/transactions')
    .set(authorizationHeaders)
    .send({
      assetId: 'ast_0KAm3He1ze11iSSR4ze0',
      startDate,
      duration: { d: 3 },
      quantity: 1,
      value: 500,
      ownerAmount: 400,
      metadata: { dummy: true }
    })
    .expect(200)

  t.is(transaction2.startDate, startDate)
  t.is(transaction2.endDate, computeDate(startDate, '3 days'))
  t.is(transaction2.quantity, 1)
  t.deepEqual(transaction2.duration, { d: 3 })
  t.is(transaction2.assetId, 'ast_0KAm3He1ze11iSSR4ze0')
  t.is(transaction2.value, 500)
  t.is(transaction2.ownerAmount, 400) // computed via passed value
  t.is(transaction2.takerAmount, 575) // computed via passed value
  t.is(transaction2.platformAmount, 175)
  t.is(transaction2.metadata.dummy, true)

  const { body: transaction3 } = await request(t.context.serverUrl)
    .post('/transactions')
    .set(authorizationHeaders)
    .send({
      assetId: 'ast_0KAm3He1ze11iSSR4ze0',
      startDate,
      duration: { d: 3 },
      quantity: 1,
      ownerAmount: 600,
      metadata: { dummy: true }
    })
    .expect(200)

  t.is(transaction3.startDate, startDate)
  t.is(transaction3.endDate, computeDate(startDate, '3 days'))
  t.is(transaction3.quantity, 1)
  t.deepEqual(transaction3.duration, { d: 3 })
  t.is(transaction3.assetId, 'ast_0KAm3He1ze11iSSR4ze0')
  t.is(transaction3.value, 600)
  t.is(transaction3.ownerAmount, 600) // overriden value
  t.is(transaction3.takerAmount, 690)
  t.is(transaction3.platformAmount, 90)
  t.is(transaction3.metadata.dummy, true)
})

test('sets pricing on transaction without attaching any asset', async (t) => {
  // use a different user because the owner cannot book her own asset
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'transaction:create:all',
      'transaction:edit:all',
      'transaction:config:all'
    ]
  })

  const { body: transaction } = await request(t.context.serverUrl)
    .post('/transactions')
    .set(authorizationHeaders)
    .send({
      value: 1000,
      ownerAmount: 900
    })
    .expect(200)

  t.truthy(transaction.id)
  t.is(transaction.value, 1000)
  t.is(transaction.ownerAmount, 900)
  t.is(transaction.takerAmount, null)

  const { body: updatedTransaction } = await request(t.context.serverUrl)
    .patch(`/transactions/${transaction.id}`)
    .set(authorizationHeaders)
    .send({
      takerAmount: 1500
    })
    .expect(200)

  t.truthy(updatedTransaction.id)
  t.is(updatedTransaction.value, 1000)
  t.is(updatedTransaction.ownerAmount, 900)
  t.is(updatedTransaction.takerAmount, 1500)
})

test('updates a transaction', async (t) => {
  // use a different user because the owner cannot book her own asset
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:edit:all'],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178'
  })

  const now = new Date().toISOString()
  const startDate = computeDate(now, '10 days')

  const transaction = await createEmptyTransaction(t)

  const { body: updatedTransaction } = await request(t.context.serverUrl)
    .patch(`/transactions/${transaction.id}`)
    .set(authorizationHeaders)
    .send({
      assetId: 'ast_0KAm3He1ze11iSSR4ze0',
      startDate,
      duration: { d: 3 },
      quantity: 1,
      metadata: { dummy: true }
    })
    .expect(200)

  t.is(updatedTransaction.startDate, startDate)
  t.is(updatedTransaction.endDate, computeDate(startDate, '3 days'))
  t.is(updatedTransaction.quantity, 1)
  t.deepEqual(updatedTransaction.duration, { d: 3 })
  t.is(updatedTransaction.assetId, 'ast_0KAm3He1ze11iSSR4ze0')
  t.is(typeof updatedTransaction.value, 'number')
  t.is(typeof updatedTransaction.ownerAmount, 'number')
  t.is(typeof updatedTransaction.takerAmount, 'number')
  t.is(typeof updatedTransaction.platformAmount, 'number')
  t.is(updatedTransaction.metadata.dummy, true)
})

test('updates the transaction status', async (t) => {
  // use a different user because the owner cannot book her own asset
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:edit:all', 'transaction:config:all'],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178'
  })

  const status = 'unknown status'

  const transaction = await createEmptyTransaction(t)

  const { body: updatedTransaction } = await request(t.context.serverUrl)
    .patch(`/transactions/${transaction.id}`)
    .set(authorizationHeaders)
    .send({
      status
    })
    .expect(200)

  t.is(updatedTransaction.status, status)
  t.is(updatedTransaction.statusHistory[0].status, status)
})

test('cannot trigger a transition that does not exist', async (t) => {
  // use a different user because the owner cannot book her own asset
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:edit:all', 'transaction:config:all', 'transaction:transition:all'],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178'
  })

  const status = 'unknown status'

  const { body: transaction1 } = await request(t.context.serverUrl)
    .patch('/transactions/trn_a3BfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      status
    })
    .expect(200)

  t.is(transaction1.status, status)
  t.is(transaction1.statusHistory[0].status, status)

  await request(t.context.serverUrl)
    .post('/transactions/trn_a3BfQps1I3a1gJYz2I3a/transitions')
    .set(authorizationHeaders)
    .send({
      name: 'pay'
    })
    .expect(422)
})

test('cannot update the transaction status if the permission "transaction:config:all" is missing', async (t) => {
  // use a different user because the owner cannot book her own asset
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:edit:all'],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178'
  })

  const transaction = await createEmptyTransaction(t)

  const status = 'unknown status'

  await request(t.context.serverUrl)
    .patch(`/transactions/${transaction.id}`)
    .set(authorizationHeaders)
    .send({
      status
    })
    .expect(403)

  t.pass()
})

test('cannot detach an asset from a transaction', async (t) => {
  // use a different user because the owner cannot book her own asset
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:edit:all'],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178'
  })

  await request(t.context.serverUrl)
    .patch('/transactions/trn_a3BfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .send({
      assetId: null
    })
    .expect(400)

  t.pass()
})

// the asset is available thanks to the relative positive quantity for the associated availability
test('updates a transaction on a zero quantity asset', async (t) => {
  // use a different user because the owner cannot book her own asset
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:edit:all'],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178'
  })

  const now = new Date().toISOString()
  const startDate = computeDate(now, '2 days')

  const transaction = await createEmptyTransaction(t)

  const { body: updatedTransaction } = await request(t.context.serverUrl)
    .patch(`/transactions/${transaction.id}`)
    .set(authorizationHeaders)
    .send({
      assetId: 'ast_g29VxDs1DEa1gEk9KDEa',
      startDate,
      duration: { d: 1 },
      quantity: 1,
      metadata: { dummy: true }
    })
    .expect(200)

  t.is(updatedTransaction.startDate, startDate)
  t.is(updatedTransaction.endDate, computeDate(startDate, '1 day'))
  t.is(updatedTransaction.quantity, 1)
  t.deepEqual(updatedTransaction.duration, { d: 1 })
  t.is(updatedTransaction.assetId, 'ast_g29VxDs1DEa1gEk9KDEa')
  t.is(typeof updatedTransaction.value, 'number')
  t.is(typeof updatedTransaction.ownerAmount, 'number')
  t.is(typeof updatedTransaction.takerAmount, 'number')
  t.is(typeof updatedTransaction.platformAmount, 'number')
  t.is(updatedTransaction.metadata.dummy, true)
})

test('fails to update a transaction on an asset that is not active or not validated', async (t) => {
  // use a different user because the owner cannot book her own asset
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:edit:all'],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178'
  })

  const now = new Date().toISOString()
  const startDate = computeDate(now, '2 days')

  const transaction = await createEmptyTransaction(t)

  await request(t.context.serverUrl)
    .patch(`/transactions/${transaction.id}`)
    .set(authorizationHeaders)
    .send({
      assetId: 'ast_2l7fQps1I3a1gJYz2I3a',
      startDate,
      duration: { d: 4 },
      quantity: 1,
      metadata: { dummy: true }
    })
    .expect(422)

  t.pass()
})

test('fails to update a transaction due to asset unavailability', async (t) => {
  // use a different user because the owner cannot book her own asset
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:edit:all'],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178'
  })

  const now = new Date().toISOString()
  const startDate = computeDate(now, '2 days')

  const transaction = await createEmptyTransaction(t)

  await request(t.context.serverUrl)
    .patch(`/transactions/${transaction.id}`)
    .set(authorizationHeaders)
    .send({
      assetId: 'ast_0TYM7rs1OwP1gQRuCOwP',
      startDate,
      duration: { d: 4 },
      quantity: 1,
      metadata: { dummy: true }
    })
    .expect(422)

  t.pass()
})

test('updates a transaction without assigning an asset', async (t) => {
  // use a different user because the owner cannot book her own asset
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:edit:all'],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178'
  })

  const now = new Date().toISOString()
  const startDate = computeDate(now, '10 days')

  const transaction = await createEmptyTransaction(t)

  const { body: updatedTransaction } = await request(t.context.serverUrl)
    .patch(`/transactions/${transaction.id}`)
    .set(authorizationHeaders)
    .send({
      startDate,
      duration: { d: 3 },
      quantity: 1,
      metadata: { dummy: true }
    })
    .expect(200)

  t.is(updatedTransaction.startDate, startDate)
  t.is(updatedTransaction.endDate, computeDate(startDate, '3 days'))
  t.is(updatedTransaction.quantity, 1)
  t.deepEqual(updatedTransaction.duration, { d: 3 })
  t.is(updatedTransaction.assetId, null)
  t.is(updatedTransaction.value, null)
  t.is(updatedTransaction.ownerAmount, null)
  t.is(updatedTransaction.takerAmount, null)
  t.is(updatedTransaction.platformAmount, null)
  t.is(updatedTransaction.metadata.dummy, true)
})

test('updates a transaction by specifying the end date', async (t) => {
  // use a different user because the owner cannot book her own asset
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:edit:all'],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178'
  })

  const transaction = await createEmptyTransaction(t)

  const now = new Date().toISOString()
  const startDate = computeDate(now, '10 days')
  const endDate = computeDate(now, '13 days')

  const { body: updatedTransaction } = await request(t.context.serverUrl)
    .patch(`/transactions/${transaction.id}`)
    .set(authorizationHeaders)
    .send({
      startDate,
      endDate,
      quantity: 1,
      metadata: { dummy: true }
    })
    .expect(200)

  t.is(updatedTransaction.startDate, startDate)
  t.is(updatedTransaction.endDate, endDate)
  t.is(updatedTransaction.quantity, 1)
  t.deepEqual(updatedTransaction.duration, { d: 3 })
  t.is(updatedTransaction.assetId, null)
  t.is(updatedTransaction.value, null)
  t.is(updatedTransaction.ownerAmount, null)
  t.is(updatedTransaction.takerAmount, null)
  t.is(updatedTransaction.platformAmount, null)
  t.is(updatedTransaction.metadata.dummy, true)
})

test('updates a transaction multiple times with different information', async (t) => {
  // use a different user because the owner cannot book her own asset
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:edit:all', 'transaction:config:all'],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178'
  })

  const now = new Date().toISOString()

  const startDate1 = computeDate(now, '10 days')

  const transaction = await createEmptyTransaction(t)

  // update with an assigned asset
  const { body: updatedTransaction1 } = await request(t.context.serverUrl)
    .patch(`/transactions/${transaction.id}`)
    .set(authorizationHeaders)
    .send({
      assetId: 'ast_0KAm3He1ze11iSSR4ze0',
      startDate: startDate1,
      duration: { d: 3 },
      quantity: 1,
      metadata: { dummy: true }
    })
    .expect(200)

  t.is(updatedTransaction1.startDate, startDate1)
  t.is(updatedTransaction1.endDate, computeDate(startDate1, '3 days'))
  t.is(updatedTransaction1.quantity, 1)
  t.deepEqual(updatedTransaction1.duration, { d: 3 })
  t.is(updatedTransaction1.assetId, 'ast_0KAm3He1ze11iSSR4ze0')
  t.is(typeof updatedTransaction1.value, 'number')
  t.is(typeof updatedTransaction1.ownerAmount, 'number')
  t.is(typeof updatedTransaction1.takerAmount, 'number')
  t.is(typeof updatedTransaction1.platformAmount, 'number')
  t.is(updatedTransaction1.metadata.dummy, true)

  // update one transaction parameter, but keep the saved asset
  const { body: updatedTransaction2 } = await request(t.context.serverUrl)
    .patch(`/transactions/${transaction.id}`)
    .set(authorizationHeaders)
    .send({
      duration: { d: 2 },
      metadata: { dummy: true }
    })
    .expect(200)

  t.is(updatedTransaction2.startDate, startDate1)
  t.is(updatedTransaction2.quantity, 1)
  t.deepEqual(updatedTransaction2.duration, { d: 2 })
  t.is(updatedTransaction2.assetId, 'ast_0KAm3He1ze11iSSR4ze0')
  t.false(updatedTransaction1.value === updatedTransaction2.value)
  t.false(updatedTransaction1.ownerAmount === updatedTransaction2.ownerAmount)
  t.false(updatedTransaction1.takerAmount === updatedTransaction2.takerAmount)
  t.false(updatedTransaction1.platformAmount === updatedTransaction2.platformAmount)
  t.is(updatedTransaction2.metadata.dummy, true)

  const startDate2 = computeDate(now, '2 days')

  // update with a different asset
  const { body: updatedTransaction3 } = await request(t.context.serverUrl)
    .patch(`/transactions/${transaction.id}`)
    .set(authorizationHeaders)
    .send({
      assetId: 'ast_g29VxDs1DEa1gEk9KDEa',
      startDate: startDate2,
      duration: { d: 1 },
      quantity: 1,
      metadata: { dummy: true }
    })
    .expect(200)

  t.is(updatedTransaction3.startDate, startDate2)
  t.is(updatedTransaction3.quantity, 1)
  t.deepEqual(updatedTransaction3.duration, { d: 1 })
  t.is(updatedTransaction3.assetId, 'ast_g29VxDs1DEa1gEk9KDEa')
  t.false(updatedTransaction2.value === updatedTransaction3.value)
  t.false(updatedTransaction2.ownerAmount === updatedTransaction3.ownerAmount)
  t.false(updatedTransaction2.takerAmount === updatedTransaction3.takerAmount)
  t.false(updatedTransaction2.platformAmount === updatedTransaction3.platformAmount)
  t.is(updatedTransaction3.metadata.dummy, true)
})

test('updates a transaction by specifying pricing', async (t) => {
  // use a different user because the owner cannot book her own asset
  const notEnoughPermissionsAuthorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:edit:all'],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178'
  })
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'transaction:edit:all',
      'transaction:config:all'
    ],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178'
  })

  const now = new Date().toISOString()
  const startDate = computeDate(now, '10 days')

  const transaction = await createEmptyTransaction(t)

  await request(t.context.serverUrl)
    .patch(`/transactions/${transaction.id}`)
    .set(notEnoughPermissionsAuthorizationHeaders)
    .send({
      assetId: 'ast_0KAm3He1ze11iSSR4ze0',
      startDate,
      duration: { d: 3 },
      value: 500,
      quantity: 1,
      metadata: { dummy: true }
    })
    .expect(403)

  const { body: updatedTransaction1 } = await request(t.context.serverUrl)
    .patch(`/transactions/${transaction.id}`)
    .set(authorizationHeaders)
    .send({
      assetId: 'ast_0KAm3He1ze11iSSR4ze0',
      startDate,
      duration: { d: 3 },
      quantity: 1,
      value: 500,
      metadata: { dummy: true }
    })
    .expect(200)

  t.is(updatedTransaction1.startDate, startDate)
  t.is(updatedTransaction1.endDate, computeDate(startDate, '3 days'))
  t.is(updatedTransaction1.quantity, 1)
  t.deepEqual(updatedTransaction1.duration, { d: 3 })
  t.is(updatedTransaction1.assetId, 'ast_0KAm3He1ze11iSSR4ze0')
  t.is(updatedTransaction1.value, 500)
  t.is(updatedTransaction1.ownerAmount, 475) // computed via passed value
  t.is(updatedTransaction1.takerAmount, 575) // computed via passed value
  t.is(updatedTransaction1.platformAmount, 100)
  t.is(updatedTransaction1.metadata.dummy, true)

  const { body: updatedTransaction2 } = await request(t.context.serverUrl)
    .patch(`/transactions/${transaction.id}`)
    .set(authorizationHeaders)
    .send({
      assetId: 'ast_0KAm3He1ze11iSSR4ze0',
      startDate,
      duration: { d: 3 },
      quantity: 1,
      value: 500,
      ownerAmount: 400,
      metadata: { dummy: true }
    })
    .expect(200)

  t.is(updatedTransaction2.startDate, startDate)
  t.is(updatedTransaction2.endDate, computeDate(startDate, '3 days'))
  t.is(updatedTransaction2.quantity, 1)
  t.deepEqual(updatedTransaction2.duration, { d: 3 })
  t.is(updatedTransaction2.assetId, 'ast_0KAm3He1ze11iSSR4ze0')
  t.is(updatedTransaction2.value, 500)
  t.is(updatedTransaction2.ownerAmount, 400) // computed via passed value
  t.is(updatedTransaction2.takerAmount, 575) // computed via passed value
  t.is(updatedTransaction2.platformAmount, 175)
  t.is(updatedTransaction2.metadata.dummy, true)

  const { body: updatedTransaction3 } = await request(t.context.serverUrl)
    .patch(`/transactions/${transaction.id}`)
    .set(authorizationHeaders)
    .send({
      assetId: 'ast_0KAm3He1ze11iSSR4ze0',
      startDate,
      duration: { d: 3 },
      quantity: 1,
      ownerAmount: 600,
      metadata: { dummy: true }
    })
    .expect(200)

  t.is(updatedTransaction3.startDate, startDate)
  t.is(updatedTransaction3.endDate, computeDate(startDate, '3 days'))
  t.is(updatedTransaction3.quantity, 1)
  t.deepEqual(updatedTransaction3.duration, { d: 3 })
  t.is(updatedTransaction3.assetId, 'ast_0KAm3He1ze11iSSR4ze0')
  t.is(updatedTransaction3.value, 600)
  t.is(updatedTransaction3.ownerAmount, 600) // overriden value
  t.is(updatedTransaction3.takerAmount, 690)
  t.is(updatedTransaction3.platformAmount, 90)
  t.is(updatedTransaction3.metadata.dummy, true)
})

test('confirms a transaction', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['transaction:transition:all'] })

  const transaction = await createTransactionWithAsset(t)

  const { body: updatedTransaction } = await request(t.context.serverUrl)
    .post(`/transactions/${transaction.id}/transitions`)
    .set(authorizationHeaders)
    .send({
      name: 'confirm'
    })
    .expect(200)

  t.is(updatedTransaction.id, transaction.id)

  const confirmationStep = updatedTransaction.statusHistory.find(step => step.status === 'confirmed')
  t.truthy(confirmationStep)
  t.truthy(confirmationStep.date)
})

test('cannot confirm a transaction that has no associated asset', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['transaction:transition:all'] })

  const transaction = await createEmptyTransaction(t)

  await request(t.context.serverUrl)
    .post(`/transactions/${transaction.id}/transitions`)
    .set(authorizationHeaders)
    .send({
      name: 'confirm'
    })
    .expect(422)

  t.pass()
})

test('confirms and pays a transaction', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['transaction:transition:all'] })

  const transaction = await createTransactionWithAsset(t)

  const { body: updatedTransaction } = await request(t.context.serverUrl)
    .post(`/transactions/${transaction.id}/transitions`)
    .set(authorizationHeaders)
    .send({
      name: 'confirmAndPay'
    })
    .expect(200)

  t.is(updatedTransaction.id, transaction.id)

  const confirmationAndPaymentStep = updatedTransaction.statusHistory.find(step => step.status === 'pending-acceptance')
  t.truthy(confirmationAndPaymentStep)
  t.truthy(confirmationAndPaymentStep.date)
})

test('pays for a transaction', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['transaction:transition:all'] })

  const transaction = await createTransactionWithAsset(t)

  const { body: updatedTransaction } = await request(t.context.serverUrl)
    .post(`/transactions/${transaction.id}/transitions`)
    .set(authorizationHeaders)
    .send({
      name: 'pay'
    })
    .expect(200)

  t.is(updatedTransaction.id, transaction.id)

  const paymentStep = updatedTransaction.statusHistory.find(step => step.status === 'pending-acceptance')
  t.truthy(paymentStep)
  t.truthy(paymentStep.date)
})

test('cannot pay for a transaction that has no associated asset', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['transaction:transition:all'] })

  const transaction = await createEmptyTransaction(t)

  await request(t.context.serverUrl)
    .post(`/transactions/${transaction.id}/transitions`)
    .set(authorizationHeaders)
    .send({
      name: 'pay'
    })
    .expect(422)

  t.pass()
})

test('pays an accepted transaction and cancels the overlapped transactions that exceeds the asset quantity', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'transaction:transition:all',
      'transaction:list:all'
    ]
  })

  const { body: updatedTransaction } = await request(t.context.serverUrl)
    .post('/transactions/trn_ZVZfQps1I3a1gJYz2I3a/transitions')
    .set(authorizationHeaders)
    .send({
      name: 'pay'
    })
    .expect(200)

  t.is(updatedTransaction.id, 'trn_ZVZfQps1I3a1gJYz2I3a')
  t.truthy(updatedTransaction.statusHistory.find(step => step.status === 'validated'))

  await timeoutForTransactionsCancellation()

  const results = await request(t.context.serverUrl)
    .get('/transactions?id=trn_a3BfQps1I3a1gJYz2I3a,trn_UG1fQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  const obj = results.body
  const { results: transactions } = obj

  t.is(transactions.length, 2)

  transactions.forEach(transaction => {
    t.truthy(transaction.cancelledDate)
  })
})

test('accepts a transaction', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['transaction:transition:all'] })

  const transaction = await createTransactionWithAsset(t)

  const { body: updatedTransaction } = await request(t.context.serverUrl)
    .post(`/transactions/${transaction.id}/transitions`)
    .set(authorizationHeaders)
    .send({
      name: 'accept'
    })
    .expect(200)

  t.is(updatedTransaction.id, transaction.id)

  const acceptationStep = updatedTransaction.statusHistory.find(step => step.status === 'accepted')
  t.truthy(acceptationStep)
  t.truthy(acceptationStep.date)
})

test('cannot accept a transaction that has no associated asset', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['transaction:transition:all'] })

  const transaction = await createEmptyTransaction(t)

  await request(t.context.serverUrl)
    .post(`/transactions/${transaction.id}/transitions`)
    .set(authorizationHeaders)
    .send({
      name: 'accept'
    })
    .expect(422)

  t.pass()
})

test('accepts a paid transaction and cancels the overlapped transactions that exceeds the asset quantity', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'transaction:transition:all',
      'transaction:list:all'
    ]
  })

  const { body: updatedTransaction } = await request(t.context.serverUrl)
    .post('/transactions/trn_RjhfQps1I3a1gJYz2I3a/transitions')
    .set(authorizationHeaders)
    .send({
      name: 'accept'
    })
    .expect(200)

  t.is(updatedTransaction.id, 'trn_RjhfQps1I3a1gJYz2I3a')

  const validationStep = updatedTransaction.statusHistory.find(step => step.status === 'validated')
  t.truthy(validationStep)
  t.truthy(validationStep.date)

  await timeoutForTransactionsCancellation()

  const results = await request(t.context.serverUrl)
    .get('/transactions?id=trn_a3BfQps1I3a1gJYz2I3a,trn_UG1fQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  const obj = results.body
  const { results: transactions } = obj

  t.is(transactions.length, 2)

  transactions.forEach(transaction => {
    t.truthy(transaction.cancelledDate)
  })
})

test('cancels a transaction', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['transaction:transition:all'] })

  const transaction = await createTransactionWithAsset(t)

  const { body: updatedTransaction } = await request(t.context.serverUrl)
    .post(`/transactions/${transaction.id}/transitions`)
    .set(authorizationHeaders)
    .send({
      name: 'cancel',
      data: {
        cancellationReason: 'declinedByOwner'
      }
    })
    .expect(200)

  t.is(updatedTransaction.id, transaction.id)

  const cancellationStep = updatedTransaction.statusHistory.find(step => step.status === 'cancelled')

  t.truthy(cancellationStep)
  t.truthy(cancellationStep.date)
  t.true(cancellationStep.data.cancellationReason === 'declinedByOwner')
  t.truthy(updatedTransaction.cancelledDate)
  t.true(updatedTransaction.cancelledDate === cancellationStep.date)
})

test('cannot trigger a transaction transition if the current user is not included in the transition actors list', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:transition'],
    userId: 'anotherUser'
  })

  const transaction = await createTransactionWithAsset(t)

  await request(t.context.serverUrl)
    .post(`/transactions/${transaction.id}/transitions`)
    .send({
      name: 'pay'
    })
    .set(authorizationHeaders)
    .expect(403)

  t.pass()
})

test('can process a transaction if the current user is not included in the transition actors list but has the all permission', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: ['transaction:transition:all'],
    userId: 'anotherUser'
  })

  const transaction = await createTransactionWithAsset(t)

  await request(t.context.serverUrl)
    .post(`/transactions/${transaction.id}/transitions`)
    .send({
      name: 'pay'
    })
    .set(authorizationHeaders)
    .expect(200)

  t.pass()
})

test('asset quantity changes when transaction is validated (asset type is non time based and non infinite stock)', async (t) => {
  const createAssetAuthorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'asset:create:all',
      'assetType:create:all'
    ],
    userId: 'user1'
  })
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'asset:create:all',
      'transaction:create:all',
      'transaction:edit:all',
      'transaction:transition:all',
      'transaction:config:all'
    ],
    userId: 'user2' // another user (otherwise owner cannot book the asset)
  })

  const { body: assetType } = await request(t.context.serverUrl)
    .post('/asset-types')
    .set(createAssetAuthorizationHeaders)
    .send({
      name: 'Asset type example',
      timeBased: false,
      infiniteStock: false,
      unavailableWhen: ['accepted'] // customize the transaction statuses that make asset unavailable
    })
    .expect(200)

  const { body: asset } = await request(t.context.serverUrl)
    .post('/assets')
    .set(createAssetAuthorizationHeaders)
    .send({
      name: 'Asset must change quantity',
      assetTypeId: assetType.id,
      quantity: 10,
      price: 1000,
      currency: 'USD'
    })
    .expect(200)

  t.is(asset.quantity, 10)

  // VIA TRANSITIONS
  const { body: transaction1 } = await request(t.context.serverUrl)
    .post('/transactions')
    .set(authorizationHeaders)
    .send({
      assetId: asset.id,
      quantity: 2
    })
    .expect(200)

  await request(t.context.serverUrl)
    .post(`/transactions/${transaction1.id}/transitions`)
    .set(authorizationHeaders)
    .send({
      name: 'accept',
    })
    .expect(200)

  const { body: assetAfterTransaction1Acceptation } = await request(t.context.serverUrl)
    .get(`/assets/${asset.id}`)
    .set(createAssetAuthorizationHeaders)
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 1000))

  t.is(assetAfterTransaction1Acceptation.quantity, 8)

  await request(t.context.serverUrl)
    .post(`/transactions/${transaction1.id}/transitions`)
    .set(authorizationHeaders)
    .send({
      name: 'cancel',
      data: {
        cancellationReason: 'noReason'
      }
    })
    .expect(200)

  const { body: assetAfterTransaction1Cancellation } = await request(t.context.serverUrl)
    .get(`/assets/${asset.id}`)
    .set(createAssetAuthorizationHeaders)
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 1000))

  t.is(assetAfterTransaction1Cancellation.quantity, 10)

  // VIA TRANSACTION UPDATE
  const { body: transaction2 } = await request(t.context.serverUrl)
    .post('/transactions')
    .set(authorizationHeaders)
    .send({
      assetId: asset.id,
      quantity: 4
    })
    .expect(200)

  await request(t.context.serverUrl)
    .patch(`/transactions/${transaction2.id}`)
    .set(authorizationHeaders)
    .send({
      status: 'accepted'
    })
    .expect(200)

  const { body: assetAfterTransaction2Acceptation } = await request(t.context.serverUrl)
    .get(`/assets/${asset.id}`)
    .set(createAssetAuthorizationHeaders)
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 1000))

  t.is(assetAfterTransaction2Acceptation.quantity, 6)

  await request(t.context.serverUrl)
    .patch(`/transactions/${transaction2.id}`)
    .set(authorizationHeaders)
    .send({
      status: 'cancelled'
    })
    .expect(200)

  const { body: assetAfterTransaction2Cancellation } = await request(t.context.serverUrl)
    .get(`/assets/${asset.id}`)
    .set(createAssetAuthorizationHeaders)
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 1000))

  t.is(assetAfterTransaction2Cancellation.quantity, 10)
})

// ////////// //
// VALIDATION //
// ////////// //

test('fails to preview a transaction if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .post('/transactions/preview')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // missing required parameters
  result = await request(t.context.serverUrl)
    .post('/transactions/preview')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({})
    .expect(400)

  error = result.body
  t.true(error.message.includes('"assetId" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .post('/transactions/preview')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      assetId: true,
      startDate: true,
      endDate: true,
      duration: true,
      quantity: 'invalid',
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"assetId" must be a string'))
  t.true(error.message.includes('"startDate" must be a string'))
  t.true(error.message.includes('"endDate" must be a string'))
  t.true(error.message.includes('"duration" must be of type object'))
  t.true(error.message.includes('"quantity" must be a number'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

test('fails to create a transaction if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .post('/transactions')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .post('/transactions')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      assetId: true,
      startDate: true,
      endDate: true,
      duration: true,
      quantity: 'invalid',
      takerId: true,
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"assetId" must be a string'))
  t.true(error.message.includes('"startDate" must be a string'))
  t.true(error.message.includes('"endDate" must be a string'))
  t.true(error.message.includes('"duration" must be of type object'))
  t.true(error.message.includes('"quantity" must be a number'))
  t.true(error.message.includes('"takerId" must be a string'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

test('fails to update a transaction if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .patch('/transactions/trn_UEZfQps1I3a1gJYz2I3a')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .patch('/transactions/trn_UEZfQps1I3a1gJYz2I3a')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      assetId: true,
      startDate: true,
      endDate: true,
      duration: true,
      quantity: 'invalid',
      status: true,
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"assetId" must be a string'))
  t.true(error.message.includes('"startDate" must be a string'))
  t.true(error.message.includes('"endDate" must be a string'))
  t.true(error.message.includes('"duration" must be of type object'))
  t.true(error.message.includes('"quantity" must be a number'))
  t.true(error.message.includes('"status" must be a string'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

test('fails to create a transaction transition if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .post('/transactions/trn_UEZfQps1I3a1gJYz2I3a/transitions')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // missing required parameters
  result = await request(t.context.serverUrl)
    .post('/transactions/trn_UEZfQps1I3a1gJYz2I3a/transitions')
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
    .post('/transactions/trn_UEZfQps1I3a1gJYz2I3a/transitions')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      name: true,
      data: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"name" must be a string'))
  t.true(error.message.includes('"data" must be of type object'))
})

// ////// //
// EVENTS //
// ////// //

// Event tests must run serially before the other tests
test.serial('generates transaction__* events', async (t) => {
  const { Event } = await getModels({
    platformId: t.context.platformId,
    env: t.context.env
  })
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'transaction:create:all',
      'transaction:edit:all',
      'transaction:config:all',
      'transaction:transition:all',
      'platformData:edit:all',
      'event:list:all'
    ],
    userId: 'c12ca46b-995c-487c-a940-d9e41e0ff178',
    readNamespaces: ['custom'],
    editNamespaces: ['custom']
  })

  const now = new Date().toISOString()
  const startDate = computeDate(now, '40 days')

  let oldEvents = []

  // check create transaction event
  const { body: transaction } = await request(t.context.serverUrl)
    .post('/transactions')
    .set(authorizationHeaders)
    .send({
      assetId: 'ast_0TYM7rs1OwP1gQRuCOwP',
      startDate,
      duration: { d: 3 },
      quantity: 1,
      metadata: { dummy: true },
      platformData: { _custom: { test: 'ok' } }
    })
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 300))

  const { body: { results: eventsAfterCreate } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders)
    .expect(200)

  const filteredEventsAfterCreate = eventsAfterCreate
  oldEvents = eventsAfterCreate

  const transactionCreatedEvent = getObjectEvent({
    events: filteredEventsAfterCreate,
    eventType: 'transaction__created',
    objectId: transaction.id
  })
  await testEventMetadata({ event: transactionCreatedEvent, object: transaction, t })
  t.is(transactionCreatedEvent.object.assetId, transaction.assetId)
  t.is(transactionCreatedEvent.object.startDate, transaction.startDate)
  t.deepEqual(transactionCreatedEvent.object.duration, transaction.duration)
  t.is(transactionCreatedEvent.object.quantity, transaction.quantity)
  t.deepEqual(transactionCreatedEvent.object.platformData, { _custom: { test: 'ok' } })

  const patchPayload = {
    duration: { d: 2 },
    status: 'booked',
    platformData: { _custom: { test: 'ko' } }
  }

  // check update transaction events
  const { body: transactionUpdated } = await request(t.context.serverUrl)
    .patch(`/transactions/${transaction.id}`)
    .set(authorizationHeaders)
    .send(patchPayload)
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 300))

  const { body: { results: eventsAfterUpdate } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders)
    .expect(200)

  const filteredEventsAfterUpdate = _.differenceBy(eventsAfterUpdate, oldEvents, 'id')
  oldEvents = eventsAfterUpdate

  const transactionUpdatedEvent = getObjectEvent({
    events: filteredEventsAfterUpdate,
    eventType: 'transaction__updated',
    objectId: transactionUpdated.id
  })
  await testEventMetadata({
    event: transactionUpdatedEvent,
    object: transactionUpdated,
    t,
    patchPayload
  })
  t.is(transactionUpdatedEvent.object.assetId, transactionUpdated.assetId)
  t.is(transactionUpdatedEvent.object.startDate, transactionUpdated.startDate)
  t.deepEqual(transactionUpdatedEvent.object.duration, transactionUpdated.duration)
  t.is(transactionUpdatedEvent.object.quantity, transactionUpdated.quantity)
  t.is(transactionUpdatedEvent.object.status, transactionUpdated.status)
  t.deepEqual(transactionUpdatedEvent.object.platformData, { _custom: { test: 'ko' } })

  const eventsTypesToTestAfterUpdate = [
    'transaction__status_changed'
  ]

  const eventsAfterUpdateObject = {}
  eventsTypesToTestAfterUpdate.forEach(eventType => {
    eventsAfterUpdateObject[eventType] = getObjectEvent({
      events: filteredEventsAfterUpdate,
      eventType,
      objectId: transactionUpdated.id
    })
  })

  const config = Event.getUpdatedEventDeltasConfig('transaction')
  const deltas = Event.getUpdatedEventDeltas(config, patchPayload, transaction)

  for (const eventType in eventsAfterUpdateObject) {
    const event = eventsAfterUpdateObject[eventType]
    if (!event) t.fail(`No ${eventType} event found`)

    await testEventMetadata({ event, object: transactionUpdated, t, patchPayload: deltas[eventType] })
  }

  // check cancel transaction event
  const { body: transactionAfterCancellation } = await request(t.context.serverUrl)
    .post(`/transactions/${transaction.id}/transitions`)
    .set(authorizationHeaders)
    .send({
      name: 'cancel',
      data: {
        cancellationReason: 'declinedByOwner'
      }
    })
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 300))

  const { body: { results: eventsAfterCancellation } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders)
    .expect(200)

  const filteredEventsAfterCancellation = _.differenceBy(eventsAfterCancellation, oldEvents, 'id')
  oldEvents = eventsAfterCancellation

  const transactionStatusChangedEvent = getObjectEvent({
    events: filteredEventsAfterCancellation,
    eventType: 'transaction__status_changed',
    objectId: transactionAfterCancellation.id
  })
  await testEventMetadata({
    event: transactionStatusChangedEvent,
    object: transactionAfterCancellation,
    t
  })
  t.is(transactionStatusChangedEvent.object.name, transactionAfterCancellation.name)
  t.is(transactionStatusChangedEvent.object.type, transactionAfterCancellation.type)
})

// //////// //
// VERSIONS //
// //////// //

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('2019-05-20: list transactions with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['transaction:list:all']
  })

  await checkOffsetPaginationScenario({
    t,
    endpointUrl: '/transactions',
    authorizationHeaders,
  })
})

test('2019-05-20: list transactions with id filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['transaction:list:all']
  })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/transactions?id=trn_a3BfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  checkOffsetPaginatedListObject(t, obj)
  t.is(obj.results.length, 1)
})

test('2019-05-20: list transactions with pricing filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['transaction:list:all']
  })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/transactions?ownerAmount[lte]=500&platformAmount[gt]=10')
    .set(authorizationHeaders)
    .expect(200)

  const checkResultsFn = (t, transaction) => {
    t.true(transaction.ownerAmount <= 500)
    t.true(transaction.platformAmount > 10)
  }

  checkOffsetPaginatedListObject(t, obj, { checkResultsFn })
  t.true(obj.results.length > 0)
})
