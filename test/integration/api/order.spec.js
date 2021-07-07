require('dotenv').config()

const test = require('ava')
const request = require('supertest')
const _ = require('lodash')

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

test.before(async (t) => {
  await before({ name: 'order' })(t)
  await beforeEach()(t) // concurrent tests are much faster (~10 times here)
})
// test.beforeEach(beforeEach())
test.after(after())

test('previews an order with reference to transactions', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['order:preview:all'] })

  const { body: order } = await request(t.context.serverUrl)
    .post('/orders/preview')
    .set(authorizationHeaders)
    .send({
      transactionIds: ['trn_a3BfQps1I3a1gJYz2I3a', 'trn_RjhfQps1I3a1gJYz2I3a']
    })
    .expect(200)

  t.falsy(order.id)
  t.true(order.lines.length > 0)

  order.lines.forEach(line => {
    t.true(['trn_a3BfQps1I3a1gJYz2I3a', 'trn_RjhfQps1I3a1gJYz2I3a'].includes(line.transactionId))
  })

  const { body: order2 } = await request(t.context.serverUrl)
    .post('/orders/preview')
    .set(authorizationHeaders)
    .send({
      transactionIds: 'trn_a3BfQps1I3a1gJYz2I3a'
    })
    .expect(200)

  t.falsy(order2.id)
  t.true(order2.lines.length > 0)

  order2.lines.forEach(line => {
    t.is(line.transactionId, 'trn_a3BfQps1I3a1gJYz2I3a')
  })
})

test('cannot preview an order with transactions from different currency or taker', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['order:preview:all'] })

  await request(t.context.serverUrl)
    .post('/orders/preview')
    .set(authorizationHeaders)
    .send({
      transactionIds: ['trn_a3BfQps1I3a1gJYz2I3a', 'trn_VHgfQps1I3a1gJYz2I3a'] // different taker
    })
    .expect(422)

  await request(t.context.serverUrl)
    .post('/orders/preview')
    .set(authorizationHeaders)
    .send({
      transactionIds: ['trn_a3BfQps1I3a1gJYz2I3a', 'trn_ndKcBks1TV21ggvMqTV2'] // different currency
    })
    .expect(422)

  t.pass()
})

test('previews an order with lines', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['order:preview:all'] })

  const { body: order } = await request(t.context.serverUrl)
    .post('/orders/preview')
    .set(authorizationHeaders)
    .send({
      lines: [
        { payerId: 'user-external-id1', payerAmount: 120, platformAmount: 20, currency: 'EUR' },
        { receiverId: 'user-external-id2', receiverAmount: 100, platformAmount: 10, currency: 'EUR' }
      ]
    })
    .expect(200)

  t.falsy(order.id)
  t.is(order.currency, 'EUR')
  t.is(order.amountDue, 120)
  t.is(order.amountRemaining, 120)
  t.is(order.amountPaid, 0)
  t.true(order.lines.length === 2)

  order.lines.forEach(line => {
    t.falsy(line.id)
    t.falsy(line.createdDate)
    t.falsy(line.updatedDate)
  })
})

test('previews an order with lines and moves', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['order:preview:all'] })

  const { body: order } = await request(t.context.serverUrl)
    .post('/orders/preview')
    .set(authorizationHeaders)
    .send({
      lines: [
        { payerId: 'user-external-id1', payerAmount: 120, platformAmount: 20, currency: 'EUR' },
        { receiverId: 'user-external-id2', receiverAmount: 100, platformAmount: 10, currency: 'EUR' }
      ],
      moves: [
        { payerId: 'user-external-id1', payerAmount: 50, platformAmount: 10, currency: 'EUR' }
      ]
    })
    .expect(200)

  t.falsy(order.id)
  t.is(order.currency, 'EUR')
  t.is(order.amountDue, 120)
  t.is(order.amountRemaining, 70)
  t.is(order.amountPaid, 50)
  t.true(order.lines.length === 2)
  t.true(order.moves.length === 1)

  order.lines.forEach(line => {
    t.falsy(line.id)
    t.falsy(line.createdDate)
    t.falsy(line.updatedDate)
  })

  order.moves.forEach(move => {
    t.falsy(move.id)
    t.falsy(move.createdDate)
    t.falsy(move.updatedDate)
  })
})

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('list orders with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['order:list:all'] })

  await checkCursorPaginationScenario({
    t,
    endpointUrl: '/orders',
    authorizationHeaders,
  })
})

test('list orders with id filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['order:list:all'] })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/orders?id=ord_eP0hwes1jwf1gxMLCjwf')
    .set(authorizationHeaders)
    .expect(200)

  checkCursorPaginatedListObject(t, obj)
  t.is(obj.results.length, 1)
})

test('list orders with advanced filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['order:list:all'] })

  const result1 = await request(t.context.serverUrl)
    .get('/orders?payerId=ff4bf0dd-b1d9-49c9-8c61-3e3baa04181c')
    .set(authorizationHeaders)
    .expect(200)

  const obj1 = result1.body

  obj1.results.forEach(order => {
    t.true(['ff4bf0dd-b1d9-49c9-8c61-3e3baa04181c'].includes(order.payerId))
  })

  const result2 = await request(t.context.serverUrl)
    .get('/orders?receiverId=usr_QVQfQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  const obj2 = result2.body

  obj2.results.forEach(order => {
    t.true(order.lines.reduce((memo, line) => {
      return memo || line.receiverId === 'usr_QVQfQps1I3a1gJYz2I3a'
    }, false))
  })

  const result3 = await request(t.context.serverUrl)
    .get('/orders?transactionId=trn_Wm1fQps1I3a1gJYz2I3a')
    .set(authorizationHeaders)
    .expect(200)

  const obj3 = result3.body

  obj3.results.forEach(order => {
    t.true(order.lines.reduce((memo, line) => {
      return memo || line.transactionId === 'trn_Wm1fQps1I3a1gJYz2I3a'
    }, false))
  })
})

// use serial because no changes must be made during the check
test.serial('check list filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['order:list:all'] })

  await checkFilters({
    t,
    endpointUrl: '/orders',
    authorizationHeaders,
    checkPaginationObject: checkCursorPaginatedListObject,

    filters: [
      {
        prop: 'id',
        isArrayFilter: true,
      },
      {
        prop: 'payerId',
        isArrayFilter: true,
      },
      // `receiverId` and `transactionId` tested in other tests
    ],
  })
})

test('finds an order', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['order:read:all'] })

  const { body: order } = await request(t.context.serverUrl)
    .get('/orders/ord_eP0hwes1jwf1gxMLCjwf')
    .set(authorizationHeaders)
    .expect(200)

  t.is(order.id, 'ord_eP0hwes1jwf1gxMLCjwf')
})

test('creates an order with reference to transactions', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'order:create:all',
      'transaction:list:all'
    ]
  })

  const transactionId1 = 'bgk_svEC9Te1UPo1hqo8MUPo'
  const transactionId2 = 'bgk_dRuSeXe15jH1hS7ao5jH'

  const { body: { results: transactions } } = await request(t.context.serverUrl)
    .get(`/transactions?id=${transactionId1},${transactionId2}`)
    .set(authorizationHeaders)
    .expect(200)

  // only use transactions with no fees to check below exact amounts
  const transaction1 = transactions.find(b => b.id === transactionId1)
  const transaction2 = transactions.find(b => b.id === transactionId2)

  const { body: order } = await request(t.context.serverUrl)
    .post('/orders')
    .set(authorizationHeaders)
    .send({
      transactionIds: [transactionId1, transactionId2],
      metadata: { dummy: true }
    })
    .expect(200)

  t.truthy(order.id)
  t.is(order.metadata.dummy, true)
  t.true(order.lines.length > 0)

  order.lines.forEach(line => {
    t.false(line.reversal)
    t.true([transactionId1, transactionId2].includes(line.transactionId))
  })

  const groupedOrderLinesByTransaction = _.groupBy(order.lines, 'transactionId')

  const payerLine1 = groupedOrderLinesByTransaction[transactionId1].find(line => line.payerId)
  const receiverLine1 = groupedOrderLinesByTransaction[transactionId1].find(line => line.receiverId)

  // works because asset type has 'day' as time unit
  const receiverAmount1 = transaction1.duration.d * transaction1.unitPrice * transaction1.quantity

  t.true(payerLine1.payerAmount === receiverAmount1)
  t.true(payerLine1.receiverAmount === 0)
  t.true(payerLine1.platformAmount === 0)
  t.is(payerLine1.currency, transaction1.currency)

  t.true(receiverLine1.payerAmount === 0)
  t.true(receiverLine1.receiverAmount === receiverAmount1)
  t.true(receiverLine1.platformAmount === 0)
  t.is(receiverLine1.currency, transaction1.currency)

  const payerLine2 = groupedOrderLinesByTransaction[transactionId2].find(line => line.payerId)
  const receiverLine2 = groupedOrderLinesByTransaction[transactionId2].find(line => line.receiverId)

  // works because asset type has 'day' as time unit
  const receiverAmount2 = transaction2.duration.d * transaction2.unitPrice * transaction2.quantity

  t.true(payerLine2.payerAmount === receiverAmount2)
  t.true(payerLine2.receiverAmount === 0)
  t.true(payerLine2.platformAmount === 0)
  t.is(payerLine2.currency, transaction2.currency)

  t.true(receiverLine2.payerAmount === 0)
  t.true(receiverLine2.receiverAmount === receiverAmount2)
  t.true(receiverLine2.platformAmount === 0)
  t.is(receiverLine2.currency, transaction2.currency)
})

test('cannot create an order with transactions from different currency or taker', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['order:create:all'] })

  await request(t.context.serverUrl)
    .post('/orders')
    .set(authorizationHeaders)
    .send({
      transactionIds: ['trn_a3BfQps1I3a1gJYz2I3a', 'trn_VHgfQps1I3a1gJYz2I3a'], // different taker
      metadata: { dummy: true }
    })
    .expect(422)

  await request(t.context.serverUrl)
    .post('/orders')
    .set(authorizationHeaders)
    .send({
      transactionIds: ['trn_a3BfQps1I3a1gJYz2I3a', 'trn_ndKcBks1TV21ggvMqTV2'], // different currency
      metadata: { dummy: true }
    })
    .expect(422)

  t.pass()
})

test('creates an order with lines', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['order:create:all'] })

  const { body: order } = await request(t.context.serverUrl)
    .post('/orders')
    .set(authorizationHeaders)
    .send({
      lines: [
        { payerId: 'user-external-id1', payerAmount: 120, platformAmount: 20, currency: 'EUR' },
        { receiverId: 'user-external-id2', receiverAmount: 100, platformAmount: 10, currency: 'EUR' }
      ],
      metadata: { dummy: true }
    })
    .expect(200)

  t.truthy(order.id)
  t.is(order.currency, 'EUR')
  t.is(order.amountDue, 120)
  t.is(order.amountRemaining, 120)
  t.is(order.amountPaid, 0)
  t.is(order.metadata.dummy, true)
  t.true(order.lines.length === 2)

  order.lines.forEach(line => {
    t.truthy(line.id)
    t.truthy(line.createdDate)
    t.truthy(line.updatedDate)
  })
})

test('creates an order with lines and moves', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['order:create:all'] })

  const { body: order } = await request(t.context.serverUrl)
    .post('/orders')
    .set(authorizationHeaders)
    .send({
      lines: [
        { payerId: 'user-external-id1', payerAmount: 120, platformAmount: 20, currency: 'EUR' },
        { receiverId: 'user-external-id2', receiverAmount: 100, platformAmount: 10, currency: 'EUR' }
      ],
      moves: [
        { payerId: 'user-external-id1', payerAmount: 50, platformAmount: 10, currency: 'EUR' }
      ],
      metadata: { dummy: true }
    })
    .expect(200)

  t.truthy(order.id)
  t.is(order.currency, 'EUR')
  t.is(order.amountDue, 120)
  t.is(order.amountRemaining, 70)
  t.is(order.amountPaid, 50)
  t.is(order.metadata.dummy, true)
  t.true(order.lines.length === 2)
  t.true(order.moves.length === 1)

  order.lines.forEach(line => {
    t.truthy(line.id)
    t.truthy(line.createdDate)
    t.truthy(line.updatedDate)
  })

  order.moves.forEach(move => {
    t.truthy(move.id)
    t.truthy(move.createdDate)
    t.truthy(move.updatedDate)
  })
})

test('cannot create an order with mismatch information between lines and moves', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['order:create:all'] })

  await request(t.context.serverUrl)
    .post('/orders')
    .set(authorizationHeaders)
    .send({
      lines: [
        { payerId: 'user-external-id1', payerAmount: 120, platformAmount: 20, currency: 'EUR' },
        { receiverId: 'user-external-id2', receiverAmount: 100, platformAmount: 10, currency: 'EUR' }
      ],
      moves: [
        // unknown payer
        { payerId: 'unknown-user', payerAmount: 50, platformAmount: 10, currency: 'EUR' }
      ],
      metadata: { dummy: true }
    })
    .expect(422)

  await request(t.context.serverUrl)
    .post('/orders')
    .set(authorizationHeaders)
    .send({
      lines: [
        { payerId: 'user-external-id1', payerAmount: 120, platformAmount: 20, currency: 'EUR' },
        { receiverId: 'user-external-id2', receiverAmount: 100, platformAmount: 10, currency: 'EUR' }
      ],
      moves: [
        // currency mismatch
        { payerId: 'user-external-id1', payerAmount: 50, platformAmount: 10, currency: 'USD' }
      ],
      metadata: { dummy: true }
    })
    .expect(422)

  await request(t.context.serverUrl)
    .post('/orders')
    .set(authorizationHeaders)
    .send({
      lines: [
        { payerId: 'user-external-id1', payerAmount: 120, platformAmount: 20, currency: 'EUR' }
      ],
      moves: [
        // receiver not referenced in lines
        { receiverId: 'user-external-id2', receiverAmount: 100, platformAmount: 10, currency: 'EUR' }
      ],
      metadata: { dummy: true }
    })
    .expect(422)

  t.pass()
})

test('updates an order', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['order:edit:all'] })

  const { body: order } = await request(t.context.serverUrl)
    .patch('/orders/ord_eP0hwes1jwf1gxMLCjwf')
    .set(authorizationHeaders)
    .send({
      metadata: { dummy: true }
    })
    .expect(200)

  t.is(order.id, 'ord_eP0hwes1jwf1gxMLCjwf')
  t.is(order.metadata.dummy, true)
})

// ORDER LINE

test('finds an order line', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['orderLine:read:all'] })

  const { body: orderLine } = await request(t.context.serverUrl)
    .get('/order-lines/ordl_KdA9vs1st51h6q3wst5')
    .set(authorizationHeaders)
    .expect(200)

  t.is(orderLine.id, 'ordl_KdA9vs1st51h6q3wst5')
})

test('creates an order line', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'order:read:all',
      'orderLine:create:all'
    ]
  })

  const { body: beforeOrder } = await request(t.context.serverUrl)
    .get('/orders/ord_ax0hwes1jwf1gxMLCjwf')
    .set(authorizationHeaders)
    .expect(200)

  const { body: orderLine } = await request(t.context.serverUrl)
    .post('/order-lines')
    .set(authorizationHeaders)
    .send({
      orderId: 'ord_ax0hwes1jwf1gxMLCjwf',
      transactionId: 'trn_a3BfQps1I3a1gJYz2I3a',
      payerId: 'ff4bf0dd-b1d9-49c9-8c61-3e3baa04181c',
      payerAmount: 10,
      currency: 'EUR'
    })
    .expect(200)

  t.is(orderLine.transactionId, 'trn_a3BfQps1I3a1gJYz2I3a')
  t.is(orderLine.payerId, 'ff4bf0dd-b1d9-49c9-8c61-3e3baa04181c')
  t.is(orderLine.payerAmount, 10)

  const { body: afterOrder } = await request(t.context.serverUrl)
    .get('/orders/ord_ax0hwes1jwf1gxMLCjwf')
    .set(authorizationHeaders)
    .expect(200)

  t.is(beforeOrder.amountDue + orderLine.payerAmount, afterOrder.amountDue)
})

test('cannot create an order line if payment is attempted except if it is reversal', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['orderLine:create:all'] })

  await request(t.context.serverUrl)
    .post('/order-lines')
    .set(authorizationHeaders)
    .send({
      orderId: 'ord_om2DV3s1R5E1geUuCR5E',
      transactionId: 'trn_Wm1fQps1I3a1gJYz2I3a',
      payerId: 'usr_Y0tfQps1I3a1gJYz2I3a',
      payerAmount: 10,
      currency: 'USD'
    })
    .expect(422)

  const { body: orderLine } = await request(t.context.serverUrl)
    .post('/order-lines')
    .set(authorizationHeaders)
    .send({
      orderId: 'ord_om2DV3s1R5E1geUuCR5E',
      transactionId: 'trn_Wm1fQps1I3a1gJYz2I3a',
      payerId: 'usr_Y0tfQps1I3a1gJYz2I3a',
      payerAmount: -10,
      currency: 'USD',
      reversal: true
    })
    .expect(200)

  t.is(orderLine.reversal, true)
  t.is(orderLine.payerId, 'usr_Y0tfQps1I3a1gJYz2I3a')
  t.is(orderLine.transactionId, 'trn_Wm1fQps1I3a1gJYz2I3a')
})

test('updates an order line', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['orderLine:edit:all'] })

  const { body: orderLine } = await request(t.context.serverUrl)
    .patch('/order-lines/ordl_KdA9vs1st51h6q3wst5')
    .set(authorizationHeaders)
    .send({
      metadata: { test: true }
    })
    .expect(200)

  t.is(orderLine.metadata.test, true)
})

test('updates an order line and changes amounts', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'order:read:all',
      'orderLine:edit:all'
    ]
  })

  const { body: orderLine } = await request(t.context.serverUrl)
    .patch('/order-lines/ordl_KdA9vs1st51h6q3wst5')
    .set(authorizationHeaders)
    .send({
      payerAmount: 2200,
      platformAmount: 200,
      metadata: { test: true }
    })
    .expect(200)

  t.is(orderLine.payerAmount, 2200)
  t.is(orderLine.platformAmount, 200)
  t.is(orderLine.metadata.test, true)

  const { body: afterOrder } = await request(t.context.serverUrl)
    .get('/orders/ord_eP0hwes1jwf1gxMLCjwf')
    .set(authorizationHeaders)
    .expect(200)

  t.is(afterOrder.amountDue, 2200)
  t.is(afterOrder.amountPaid, 0)
})

// ORDER MOVE

test('finds an order move', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['orderMove:read:all'] })

  const { body: orderMove } = await request(t.context.serverUrl)
    .get('/order-moves/ordm_yJLKVs101Q1gDyYe01Q')
    .set(authorizationHeaders)
    .expect(200)

  t.is(orderMove.id, 'ordm_yJLKVs101Q1gDyYe01Q')
})

test('creates an order move', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'order:read:all',
      'orderMove:create:all'
    ]
  })

  const { body: beforeOrder } = await request(t.context.serverUrl)
    .get('/orders/ord_ax1hwes1jwf1gxMLCjwf')
    .set(authorizationHeaders)
    .expect(200)

  const { body: orderMove } = await request(t.context.serverUrl)
    .post('/order-moves')
    .set(authorizationHeaders)
    .send({
      orderId: 'ord_ax1hwes1jwf1gxMLCjwf',
      transactionId: 'trn_a3BfQps1I3a1gJYz2I3a',
      payerId: 'ff4bf0dd-b1d9-49c9-8c61-3e3baa04181c',
      payerAmount: 10,
      currency: 'EUR'
    })
    .expect(200)

  t.is(orderMove.transactionId, 'trn_a3BfQps1I3a1gJYz2I3a')
  t.is(orderMove.payerId, 'ff4bf0dd-b1d9-49c9-8c61-3e3baa04181c')
  t.is(orderMove.payerAmount, 10)

  const { body: afterOrder } = await request(t.context.serverUrl)
    .get('/orders/ord_ax1hwes1jwf1gxMLCjwf')
    .set(authorizationHeaders)
    .expect(200)

  t.is(beforeOrder.amountPaid + orderMove.payerAmount, afterOrder.amountPaid)
})

test('updates an order move', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['orderMove:edit:all'] })

  const { body: orderMove } = await request(t.context.serverUrl)
    .patch('/order-moves/ordm_yJLKVs101Q1gDyYe01Q')
    .set(authorizationHeaders)
    .send({
      metadata: { test: true }
    })
    .expect(200)

  t.is(orderMove.metadata.test, true)
})

test('simulates a payment process based on a shopping cart', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'asset:list:all',
      'asset:create:all',
      'transaction:transition:all',
      'order:read:all',
      'order:create:all',
      'orderMove:create:all',
    ]
  })

  const sellingAssetTypeId = 'typ_MGsfQps1I3a1gJYz2I3a'
  const ownerId = 'usr_em9SToe1nI01iG4yRnHz'

  // /////////////// //
  // ASSETS CREATION //
  // /////////////// //

  const { body: asset1 } = await request(t.context.serverUrl)
    .post('/assets')
    .send({
      name: 'Chevrolet',
      ownerId,
      assetTypeId: sellingAssetTypeId,
      quantity: 5,
      currency: 'USD',
      price: 50000,
    })
    .set(authorizationHeaders)
    .expect(200)

  const { body: asset2 } = await request(t.context.serverUrl)
    .post('/assets')
    .send({
      name: 'Toyota',
      ownerId,
      assetTypeId: sellingAssetTypeId,
      quantity: 10,
      currency: 'USD',
      price: 40500,
    })
    .set(authorizationHeaders)
    .expect(200)

  // /////////////////// //
  // USER AUTHENTICATION //
  // /////////////////// //

  const { body: loginObject } = await request(t.context.serverUrl)
    .post('/auth/login')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      username: 'user',
      password: 'user'
    })
    .expect(200)

  const userHeaders = {
    'x-platform-id': t.context.platformId,
    'x-stelace-env': t.context.env,
    authorization: `${loginObject.tokenType} ${loginObject.accessToken}`
  }

  let { body: user } = await request(t.context.serverUrl)
    .get(`/users/${loginObject.userId}`)
    .set(userHeaders)
    .expect(200)

  // //////// //
  // SCENARIO //
  // //////// //

  // update cart without creating any transaction
  user = await updateCart(user, { assetId: asset1.id, quantity: 4 })
  t.is(getCart(user).length, 1)

  user = await updateCart(user, { assetId: asset2.id, quantity: 2 })
  t.is(getCart(user).length, 2)

  user = await updateCart(user, { assetId: asset1.id, quantity: 0 })
  t.is(getCart(user).length, 1)

  user = await updateCart(user, { assetId: asset1.id, quantity: 5 })
  t.is(getCart(user).length, 2)

  // get information before payment
  const previewedTransactions = await getPreviewedTransactions(user)
  previewedTransactions.forEach(preview => {
    t.true(_.isString(preview.assetId))
    t.true(_.isNumber(preview.quantity))
    t.true(_.isNumber(preview.unitPrice))
    t.true(_.isNumber(preview.value))
  })

  const asset1PreviewedTransaction = previewedTransactions.find(p => p.assetId === asset1.id)
  const asset2PreviewedTransaction = previewedTransactions.find(p => p.assetId === asset2.id)

  t.is(asset1PreviewedTransaction.quantity, 5)
  t.is(asset2PreviewedTransaction.quantity, 2)

  // when user attempts to pay:
  // creation of transactions and order
  const transactions = await createTransactionsFromCart(user)

  t.is(transactions.length, previewedTransactions.length)

  const order = await createOrderFromTransactions(transactions)

  t.true(order.amountRemaining !== 0)

  // receive payment confirmation (server-side)
  const updatedOrder = await payOrder(order)

  t.true(updatedOrder.amountRemaining === 0)

  // ///////////////// //
  // HELPERS FUNCTIONS //
  // ///////////////// //

  function getCart (user) {
    return _.get(user, 'metadata._private.cart', [])
  }

  async function saveCartIntoUser (user, cart) {
    const { body: updatedUser } = await request(t.context.serverUrl)
      .patch(`/users/${user.id}`)
      .send({
        metadata: {
          _private: { cart }
        }
      })
      .set(userHeaders)
      .expect(200)

    return updatedUser
  }

  async function updateCart (user, { assetId, quantity = 1 }) {
    let cart = getCart(user)

    if (quantity === 0) {
      cart = cart.filter(l => l.assetId !== assetId)
    } else {
      const line = cart.find(l => l.assetId === assetId)

      if (line) {
        cart = cart.map(l => {
          if (l.assetId === assetId) return { assetId, quantity }
          else return l
        })
      } else {
        cart = cart.concat([{ assetId, quantity }])
      }
    }

    return saveCartIntoUser(user, cart)
  }

  async function getPreviewedTransactions (user) {
    const cart = getCart(user)
    const previewedTransactions = []

    for (const cartLine of cart) {
      const { body: preview } = await request(t.context.serverUrl)
        .post('/transactions/preview')
        .send(cartLine)
        .set(userHeaders)
        .expect(200)

      previewedTransactions.push(preview)
    }

    return previewedTransactions
  }

  async function createTransactionsFromCart (user) {
    const cart = getCart(user)
    const transactions = []

    for (const cartLine of cart) {
      const { body: transaction } = await request(t.context.serverUrl)
        .post('/transactions')
        .send(cartLine)
        .set(userHeaders)
        .expect(200)

      transactions.push(transaction)
    }

    return transactions
  }

  async function createOrderFromTransactions (transactions) {
    const { body: order } = await request(t.context.serverUrl)
      .post('/orders')
      .send({
        transactionIds: transactions.map(t => t.id)
      })
      .set(userHeaders)
      .expect(200)

    return order
  }

  async function payOrder (order) {
    const transactionIds = _.uniq(order.lines.map(l => l.transactionId))

    for (const transactionId of transactionIds) {
      await request(t.context.serverUrl)
        .post(`/transactions/${transactionId}/transitions`)
        .send({ name: 'pay' })
        .set(authorizationHeaders)
        .expect(200)
    }

    await request(t.context.serverUrl)
      .post('/order-moves')
      .send({
        orderId: order.id,
        payerId: order.payerId,
        payerAmount: order.amountDue,
        currency: order.currency,
      })
      .set(authorizationHeaders)
      .expect(200)

    const { body: updatedOrder } = await request(t.context.serverUrl)
      .get(`/orders/${order.id}`)
      .set(authorizationHeaders)
      .expect(200)

    return updatedOrder
  }
})

// ////////// //
// VALIDATION //
// ////////// //

test('fails to create an order if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .post('/orders')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .post('/orders')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      transactionIds: true,
      lines: true,
      moves: true,
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"transactionIds" must be a string'))
  t.true(error.message.includes('"lines" must be an array'))
  t.true(error.message.includes('"moves" must be an array'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

test('fails to update an order if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .patch('/orders/ord_eP0hwes1jwf1gxMLCjwf')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .patch('/orders/ord_eP0hwes1jwf1gxMLCjwf')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

test('fails to create an order line if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .post('/order-lines')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // missing required parameters
  result = await request(t.context.serverUrl)
    .post('/order-lines')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({})
    .expect(400)

  error = result.body
  t.true(error.message.includes('"orderId" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .post('/order-lines')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      orderId: true,
      transactionId: true,
      reversal: 'invalid',
      payerId: true,
      payerAmount: true,
      receiverId: true,
      receiverAmount: true,
      platformAmount: true,
      currency: true,
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"orderId" must be a string'))
  t.true(error.message.includes('"transactionId" must be a string'))
  t.true(error.message.includes('"reversal" must be a boolean'))
  t.true(error.message.includes('"payerId" must be a string'))
  t.true(error.message.includes('"payerAmount" must be a number'))
  t.true(error.message.includes('"receiverId" must be a string'))
  t.true(error.message.includes('"receiverAmount" must be a number'))
  t.true(error.message.includes('"platformAmount" must be a number'))
  t.true(error.message.includes('"currency" must be a string'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

test('fails to update an order line if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .patch('/order-lines/ordl_BPlQws16p51gKm3w6p5')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .patch('/order-lines/ordl_BPlQws16p51gKm3w6p5')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

test('fails to create an order move if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .post('/order-moves')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // missing required parameters
  result = await request(t.context.serverUrl)
    .post('/order-moves')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({})
    .expect(400)

  error = result.body
  t.true(error.message.includes('"orderId" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .post('/order-moves')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      orderId: true,
      transactionId: true,
      reversal: 'invalid',
      payerId: true,
      payerAmount: true,
      receiverId: true,
      receiverAmount: true,
      platformAmount: true,
      currency: true,
      real: true,
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"orderId" must be a string'))
  t.true(error.message.includes('"transactionId" must be a string'))
  t.true(error.message.includes('"reversal" must be a boolean'))
  t.true(error.message.includes('"payerId" must be a string'))
  t.true(error.message.includes('"payerAmount" must be a number'))
  t.true(error.message.includes('"receiverId" must be a string'))
  t.true(error.message.includes('"receiverAmount" must be a number'))
  t.true(error.message.includes('"platformAmount" must be a number'))
  t.true(error.message.includes('"currency" must be a string'))
  t.true(error.message.includes('"real" must be of type object'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

test('fails to update an order move if missing or invalid parameters', async (t) => {
  let result
  let error

  // missing body
  result = await request(t.context.serverUrl)
    .patch('/order-moves/ordm_yJLKVs101Q1gDyYe01Q')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"body" is required'))

  // parameters with wrong type
  result = await request(t.context.serverUrl)
    .patch('/order-moves/ordm_yJLKVs101Q1gDyYe01Q')
    .set({
      'x-platform-id': t.context.platformId,
      'x-stelace-env': t.context.env
    })
    .send({
      real: true,
      metadata: true,
      platformData: true
    })
    .expect(400)

  error = result.body
  t.true(error.message.includes('"real" must be of type object'))
  t.true(error.message.includes('"metadata" must be of type object'))
  t.true(error.message.includes('"platformData" must be of type object'))
})

// ////// //
// EVENTS //
// ////// //

// Event tests must run serially before the other tests
test.serial('generates order__* events', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'order:create:all',
      'order:edit:all',
      'event:list:all',
      'platformData:edit:all'
    ],
    readNamespaces: ['*'],
    editNamespaces: ['*']
  })

  const { body: order } = await request(t.context.serverUrl)
    .post('/orders')
    .set(authorizationHeaders)
    .send({
      transactionIds: ['trn_a3BfQps1I3a1gJYz2I3a', 'trn_RjhfQps1I3a1gJYz2I3a'],
      metadata: { dummy: true }
    })
    .expect(200)

  const patchPayload = {
    metadata: {
      dummy: false
    },
    platformData: {
      test: 1
    }
  }

  const { body: orderUpdated } = await request(t.context.serverUrl)
    .patch(`/orders/${order.id}`)
    .set(authorizationHeaders)
    .send(patchPayload)
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, 300))

  const { body: { results: events } } = await request(t.context.serverUrl)
    .get('/events')
    .set(authorizationHeaders)
    .expect(200)

  const orderCreatedEvent = getObjectEvent({
    events,
    eventType: 'order__created',
    objectId: order.id
  })
  await testEventMetadata({ event: orderCreatedEvent, object: order, t })
  t.is(orderCreatedEvent.object.metadata.dummy, true)

  const orderUpdatedEvent = getObjectEvent({
    events,
    eventType: 'order__updated',
    objectId: orderUpdated.id
  })
  await testEventMetadata({
    event: orderUpdatedEvent,
    object: orderUpdated,
    t,
    patchPayload
  })
  t.is(orderUpdatedEvent.object.metadata.dummy, false)
})

// //////// //
// VERSIONS //
// //////// //

// need serial to ensure there is no insertion/deletion during pagination scenario
test.serial('2019-05-20: list orders with pagination', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['order:list:all']
  })

  await checkOffsetPaginationScenario({
    t,
    endpointUrl: '/orders',
    authorizationHeaders,
  })
})

test('2019-05-20: list orders with id filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    apiVersion: '2019-05-20',
    t,
    permissions: ['order:list:all']
  })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/orders?id=ord_eP0hwes1jwf1gxMLCjwf')
    .set(authorizationHeaders)
    .expect(200)

  checkOffsetPaginatedListObject(t, obj)
  t.is(obj.nbResults, 1)
})
