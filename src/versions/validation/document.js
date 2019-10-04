const Joi = require('@hapi/joi')

const { objectIdParamsSchema } = require('../../util/validation')
const { DEFAULT_NB_RESULTS_PER_PAGE } = require('../../util/list')

const orderByFields = [
  'createdDate',
  'updatedDate'
]

const dataFieldSchema = Joi.string().regex(/^data\.\w+$/)

const groupBySchema = Joi.alternatives().try([
  dataFieldSchema,
  Joi.string().valid('authorId', 'targetId')
])

const labelSchema = Joi.string().regex(/^\w+(:\w+)*$/)
const labelWithWildcardSchema = Joi.string().regex(/^(\*|(\w+)(:(\w+|\*))*)$/)
const multipleLabelsWithWildcardSchema = Joi.string().regex(/^(\*|(\w+)(:(\w+|\*))*)(,(\*|(\w+)(:(\w+|\*))*))*$/)

const schemas = {}

// ////////// //
// 2019-05-20 //
// ////////// //
schemas['2019-05-20'] = {}
schemas['2019-05-20'].getStats = {
  query: Joi.object().keys({
    // order
    orderBy: Joi.string().valid('avg', 'count', 'sum', 'min', 'max').default('count'),
    order: Joi.string().valid('asc', 'desc').default('desc'),

    // pagination
    page: Joi.number().integer().min(1).default(1),
    nbResultsPerPage: Joi.number().integer().min(1).max(100).default(DEFAULT_NB_RESULTS_PER_PAGE),

    // aggregation
    field: dataFieldSchema,
    groupBy: groupBySchema.required(),
    avgPrecision: Joi.number().integer().min(0).default(2),
    computeRanking: Joi.boolean(),

    // filters
    type: Joi.string().required(),
    label: [multipleLabelsWithWildcardSchema, Joi.array().unique().items(labelWithWildcardSchema)],
    authorId: [Joi.string(), Joi.array().unique().items(Joi.string())],
    targetId: [Joi.string(), Joi.array().unique().items(Joi.string())],
    data: Joi.object().unknown()
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
    id: [Joi.string(), Joi.array().unique().items(Joi.string())],
    type: Joi.string().required(),
    label: [multipleLabelsWithWildcardSchema, Joi.array().unique().items(labelWithWildcardSchema)],
    authorId: [Joi.string(), Joi.array().unique().items(Joi.string())],
    targetId: [Joi.string(), Joi.array().unique().items(Joi.string())],
    data: Joi.object().unknown()
  }).required()
}
schemas['2019-05-20'].read = {
  params: objectIdParamsSchema
}
schemas['2019-05-20'].create = {
  body: Joi.object().keys({
    authorId: Joi.string(),
    targetId: Joi.string(),
    type: Joi.string().required(),
    label: labelSchema,
    data: Joi.object().unknown(),
    metadata: Joi.object().unknown(),
    platformData: Joi.object().unknown()
  }).required()
}
schemas['2019-05-20'].update = {
  params: objectIdParamsSchema,
  body: schemas['2019-05-20'].create.body
    .keys({
      replaceDataProperties: Joi.array().items(Joi.string())
    })
    .forbiddenKeys('authorId', 'targetId', 'type')
}
schemas['2019-05-20'].remove = {
  params: objectIdParamsSchema
}

const validationVersions = {
  '2019-05-20': [
    {
      target: 'document.getStats',
      schema: schemas['2019-05-20'].getStats
    },
    {
      target: 'document.list',
      schema: schemas['2019-05-20'].list
    },
    {
      target: 'document.read',
      schema: schemas['2019-05-20'].read
    },
    {
      target: 'document.create',
      schema: schemas['2019-05-20'].create
    },
    {
      target: 'document.update',
      schema: schemas['2019-05-20'].update
    },
    {
      target: 'document.remove',
      schema: schemas['2019-05-20'].remove
    }
  ]
}

module.exports = validationVersions
