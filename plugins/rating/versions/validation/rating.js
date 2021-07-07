const { utils } = require('../../../serverTooling')
const { validation: { Joi } } = utils

const groupSchema = Joi.string().valid('authorId', 'targetId', 'assetId', 'transactionId')

const labelSchema = Joi.string().regex(/^\w+(:\w+)*$/)
const labelWithWildcardSchema = Joi.string().regex(/^(\*|(\w+)(:(\w+|\*))*)$/)
const multipleLabelsWithWildcardSchema = Joi.string().regex(/^(\*|(\w+)(:(\w+|\*))*)(,(\*|(\w+)(:(\w+|\*))*))*$/)

const orderByFields = [
  'createdDate',
  'updatedDate'
]

module.exports = function createValidation (deps) {
  const {
    utils: {
      validation: { objectIdParamsSchema, replaceOffsetWithCursorPagination, getArrayFilter },
      pagination: { DEFAULT_NB_RESULTS_PER_PAGE }
    }
  } = deps

  const schemas = {}

  // ////////// //
  // 2020-08-10 //
  // ////////// //
  schemas['2020-08-10'] = {}
  schemas['2020-08-10'].getStats = () => ({
    query: replaceOffsetWithCursorPagination(schemas['2019-05-20'].getStats.query)
  })
  schemas['2020-08-10'].list = () => ({
    query: replaceOffsetWithCursorPagination(schemas['2019-05-20'].list.query)
  })

  // ////////// //
  // 2019-05-20 //
  // ////////// //
  schemas['2019-05-20'] = {}
  schemas['2019-05-20'].getStats = {
    query: Joi.object().keys({
      // order
      orderBy: Joi.string().valid('avg', 'count', 'sum', 'min', 'max').default('avg'),
      order: Joi.string().valid('asc', 'desc').default('desc'),

      // pagination
      page: Joi.number().integer().min(1).default(1),
      nbResultsPerPage: Joi.number().integer().min(1).max(100).default(DEFAULT_NB_RESULTS_PER_PAGE),

      // aggregation
      groupBy: groupSchema.required(),
      computeRanking: Joi.boolean(),

      // filters
      authorId: getArrayFilter(Joi.string()),
      targetId: getArrayFilter(Joi.string()),
      assetId: Joi.string(),
      transactionId: Joi.string(),
      label: [multipleLabelsWithWildcardSchema, Joi.array().unique().items(labelWithWildcardSchema)]
    })
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
      authorId: getArrayFilter(Joi.string()),
      targetId: getArrayFilter(Joi.string()),
      assetId: Joi.string(),
      transactionId: Joi.string(),
      label: [multipleLabelsWithWildcardSchema, Joi.array().unique().items(labelWithWildcardSchema)]
    })
  }
  schemas['2019-05-20'].read = {
    params: objectIdParamsSchema
  }
  schemas['2019-05-20'].create = {
    body: Joi.object().keys({
      score: Joi.number().integer().min(0).max(100).required(),
      comment: Joi.string().max(3000).allow(null, ''),
      authorId: Joi.string(),
      targetId: Joi.string().required(),
      assetId: Joi.string(),
      transactionId: Joi.string(),
      label: labelSchema,
      metadata: Joi.object().unknown(),
      platformData: Joi.object().unknown()
    }).required()
  }
  schemas['2019-05-20'].update = {
    params: objectIdParamsSchema,
    body: schemas['2019-05-20'].create.body
      .fork(['authorId', 'targetId', 'assetId', 'transactionId'], schema => schema.forbidden())
      .fork('score', schema => schema.optional())
  }
  schemas['2019-05-20'].remove = {
    params: objectIdParamsSchema
  }

  const validationVersions = {
    '2020-08-10': [
      {
        target: 'rating.getStats',
        schema: schemas['2020-08-10'].getStats
      },
      {
        target: 'rating.list',
        schema: schemas['2020-08-10'].list
      },
    ],

    '2019-05-20': [
      {
        target: 'rating.getStats',
        schema: schemas['2019-05-20'].getStats
      },
      {
        target: 'rating.list',
        schema: schemas['2019-05-20'].list
      },
      {
        target: 'rating.read',
        schema: schemas['2019-05-20'].read
      },
      {
        target: 'rating.create',
        schema: schemas['2019-05-20'].create
      },
      {
        target: 'rating.update',
        schema: schemas['2019-05-20'].update
      },
      {
        target: 'rating.remove',
        schema: schemas['2019-05-20'].remove
      }
    ]
  }

  return validationVersions
}
