const { Joi, objectIdParamsSchema, getRangeFilter, getArrayFilter } = require('../../util/validation')
const { DEFAULT_NB_RESULTS_PER_PAGE } = require('../../util/pagination')
const { allowedTimeUnits } = require('../../util/time')

const namespaceSchema = Joi.object().keys({
  visibility: Joi.object().pattern(
    Joi.string(),
    Joi.array().items(
      Joi.string()
    ).unique()
  )
})

const orderByFields = [
  'createdDate',
  'updatedDate',
]

const durationSchema = Joi.object().pattern(
  Joi.string().valid(...allowedTimeUnits),
  Joi.number().integer().min(1)
).length(1)

const schemas = {}

// ////////// //
// 2020-08-10 //
// ////////// //
schemas['2020-08-10'] = {}
schemas['2020-08-10'].list = {
  query: Joi.object()
    .keys({
      // order
      orderBy: Joi.string().valid(...orderByFields).default('createdDate'),
      order: Joi.string().valid('asc', 'desc').default('desc'),

      // cursor pagination
      nbResultsPerPage: Joi.number().integer().min(1).max(100).default(DEFAULT_NB_RESULTS_PER_PAGE),
      startingAfter: Joi.string(),
      endingBefore: Joi.string(),

      // filters
      id: getArrayFilter(Joi.string()),
      createdDate: getRangeFilter(Joi.string().isoDate()),
      updatedDate: getRangeFilter(Joi.string().isoDate()),
      isDefault: Joi.boolean(),
      active: Joi.boolean(),
    })
    .oxor('startingAfter', 'endingBefore')
}

// ////////// //
// 2019-05-20 //
// ////////// //
schemas['2019-05-20'] = {}
schemas['2019-05-20'].list = null
schemas['2019-05-20'].read = {
  params: objectIdParamsSchema
}
schemas['2019-05-20'].create = {
  body: Joi.object().keys({
    name: Joi.string().max(255).required(),
    timeBased: Joi.boolean().required(),
    infiniteStock: Joi.boolean(),
    pricing: Joi.object().keys({
      ownerFeesPercent: Joi.number().integer().min(0).max(100),
      takerFeesPercent: Joi.number().integer().min(0).max(100)
    }),
    timing: Joi.object().keys({
      timeUnit: Joi.string().valid(...allowedTimeUnits),
      minDuration: durationSchema.allow(null),
      maxDuration: durationSchema.allow(null)
    }),
    transactionProcess: Joi.object().keys({
      initStatus: Joi.string().required(),
      cancelStatus: Joi.string().required(),
      transitions: Joi.array().items(
        Joi.object().keys({
          name: Joi.string().required(),
          from: Joi.string().required(),
          to: Joi.string().required(),
          actors: Joi.array().unique().items(Joi.string())
        })
      )
    }).allow(null),
    namespaces: namespaceSchema,
    unavailableWhen: Joi.array().unique().items(Joi.string()),
    isDefault: Joi.boolean(),
    active: Joi.boolean(),
    metadata: Joi.object().unknown(),
    platformData: Joi.object().unknown()
  }).required()
}
schemas['2019-05-20'].update = {
  params: objectIdParamsSchema,
  body: schemas['2019-05-20'].create.body
    .fork(['name', 'timeBased'], schema => schema.optional())
}
schemas['2019-05-20'].remove = {
  params: objectIdParamsSchema
}

const validationVersions = {
  '2020-08-10': [
    {
      target: 'assetType.list',
      schema: schemas['2020-08-10'].list
    },
  ],

  '2019-05-20': [
    {
      target: 'assetType.list',
      schema: schemas['2019-05-20'].list
    },
    {
      target: 'assetType.read',
      schema: schemas['2019-05-20'].read
    },
    {
      target: 'assetType.create',
      schema: schemas['2019-05-20'].create
    },
    {
      target: 'assetType.update',
      schema: schemas['2019-05-20'].update
    },
    {
      target: 'assetType.remove',
      schema: schemas['2019-05-20'].remove
    }
  ]
}

module.exports = validationVersions
