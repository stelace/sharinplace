const {
  Joi,
  objectIdParamsSchema,
  replaceOffsetWithCursorPagination,
  getArrayFilter,
} = require('../../util/validation')
const { DEFAULT_NB_RESULTS_PER_PAGE } = require('../../util/pagination')

const orderByFields = [
  'createdDate',
  'updatedDate'
]

const lineSchema = Joi.object()
  .keys({
    transactionId: Joi.string(),
    reversal: Joi.boolean().default(false),
    payerId: Joi.string(),
    payerAmount: Joi.number(),
    receiverId: Joi.string(),
    receiverAmount: Joi.number(),
    platformAmount: Joi.number(),
    currency: Joi.string().required(),
    metadata: Joi.object().unknown(),
    platformData: Joi.object().unknown()
  })
  .with('payerAmount', 'payerId')
  .with('receiverAmount', 'receiverId')

const moveSchema = Joi.object()
  .keys({
    transactionId: Joi.string(),
    reversal: Joi.boolean().default(false),
    payerId: Joi.string(),
    payerAmount: Joi.number(),
    receiverId: Joi.string(),
    receiverAmount: Joi.number(),
    platformAmount: Joi.number(),
    real: Joi.object().keys({
      payerAmount: Joi.number(),
      receiverAmount: Joi.number(),
      platformAmount: Joi.number(),
      currency: Joi.string().required()
    }).allow(null).default(null),
    currency: Joi.string(),
    metadata: Joi.object().unknown(),
    platformData: Joi.object().unknown()
  })
  .with('payerAmount', 'payerId')
  .with('receiverAmount', 'receiverId')

const schemas = {}

// ////////// //
// 2020-08-10 //
// ////////// //
schemas['2020-08-10'] = {}
schemas['2020-08-10'].list = () => ({
  query: replaceOffsetWithCursorPagination(schemas['2019-05-20'].list.query)
})

// ////////// //
// 2019-05-20 //
// ////////// //
schemas['2019-05-20'] = {}
schemas['2019-05-20'].preview = {
  body: Joi.object().keys({
    transactionIds: Joi.array().items(Joi.string()).min(1).unique().single(),
    lines: Joi.array().items(lineSchema).min(1),
    moves: Joi.array().items(moveSchema).min(1)
  }).required()
}
schemas['2019-05-20'].list = {
  query: Joi.object().keys({
    // order
    orderBy: Joi.string().valid(...orderByFields).default('createdDate'),
    order: Joi.string().valid('asc', 'desc').default('desc'),

    // pagination
    page: Joi.number().integer().min(1).default(1),
    nbResultsPerPage: Joi.number().integer().min(1).max(100).default(DEFAULT_NB_RESULTS_PER_PAGE),

    // filters
    id: getArrayFilter(Joi.string()),
    payerId: getArrayFilter(Joi.string()),
    receiverId: Joi.string(),
    transactionId: Joi.string()
  })
}
schemas['2019-05-20'].read = {
  params: objectIdParamsSchema
}
schemas['2019-05-20'].create = {
  body: Joi.object().keys({
    transactionIds: Joi.array().items(Joi.string()).min(1).unique().single(),
    lines: Joi.array().items(lineSchema).min(1),
    moves: Joi.array().items(moveSchema).min(1),
    metadata: Joi.object().unknown(),
    platformData: Joi.object().unknown()
  }).xor('lines', 'transactionIds').required()
}
schemas['2019-05-20'].update = {
  params: objectIdParamsSchema,
  body: Joi.object().keys({
    metadata: Joi.object().unknown(),
    platformData: Joi.object().unknown()
  }).required()
}
schemas['2019-05-20'].readLine = {
  params: objectIdParamsSchema
}
schemas['2019-05-20'].createLine = {
  body: lineSchema
    .keys({
      orderId: Joi.string().required()
    })
    .required()
}
schemas['2019-05-20'].updateLine = {
  body: Joi.object().keys({
    payerId: Joi.string().allow(null),
    payerAmount: Joi.number().allow(null),
    receiverId: Joi.string().allow(null),
    receiverAmount: Joi.number().allow(null),
    platformAmount: Joi.number().allow(null),
    metadata: Joi.object().unknown(),
    platformData: Joi.object().unknown()
  }).required()
}
schemas['2019-05-20'].readMove = {
  params: objectIdParamsSchema
}
schemas['2019-05-20'].createMove = {
  body: moveSchema
    .keys({
      orderId: Joi.string().required()
    })
    .required()
}
schemas['2019-05-20'].updateMove = {
  body: Joi.object().keys({
    real: Joi.object().keys({
      payerAmount: Joi.number().allow(null),
      receiverAmount: Joi.number().allow(null),
      platformAmount: Joi.number().allow(null),
      currency: Joi.string().required()
    }).allow(null).default(null),
    metadata: Joi.object().unknown(),
    platformData: Joi.object().unknown()
  }).required()
}

const validationVersions = {
  '2020-08-10': [
    {
      target: 'order.list',
      schema: schemas['2020-08-10'].list
    },
  ],

  '2019-05-20': [
    {
      target: 'order.preview',
      schema: schemas['2019-05-20'].preview
    },
    {
      target: 'order.list',
      schema: schemas['2019-05-20'].list
    },
    {
      target: 'order.read',
      schema: schemas['2019-05-20'].read
    },
    {
      target: 'order.create',
      schema: schemas['2019-05-20'].create
    },
    {
      target: 'order.update',
      schema: schemas['2019-05-20'].update
    },

    {
      target: 'orderLine.read',
      schema: schemas['2019-05-20'].readLine
    },
    {
      target: 'orderLine.create',
      schema: schemas['2019-05-20'].createLine
    },
    {
      target: 'orderLine.update',
      schema: schemas['2019-05-20'].updateLine
    },

    {
      target: 'orderMove.read',
      schema: schemas['2019-05-20'].readMove
    },
    {
      target: 'orderMove.create',
      schema: schemas['2019-05-20'].createMove
    },
    {
      target: 'orderMove.update',
      schema: schemas['2019-05-20'].updateMove
    }
  ]
}

module.exports = validationVersions
