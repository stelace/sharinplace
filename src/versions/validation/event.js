const {
  Joi,
  objectIdParamsSchema,
  getRangeFilter,
  getArrayFilter,
  replaceOffsetWithCursorPagination,
} = require('../../util/validation')
const { DEFAULT_NB_RESULTS_PER_PAGE } = require('../../util/pagination')

const orderByFields = [
  'createdDate',
]

const oldPaginationOrderByFields = [
  'name',
  'createdDate',
  'updatedDate',
  'type'
]

const schemas = {}

// match string value like 'a.b.c' or 'a[0].b.c[2]'
const getObjectSchema = (name) => Joi.string()
  .pattern(new RegExp(`^${name}((\\[(\\d+)\\]|\\.\\w+)*)$`), {
    name: `accessor string like ${name}.nested.arr[1]`
  })

const groupBySchema = Joi.alternatives().try(
  Joi.string().valid(
    'type',
    'objectType',
    'objectId',
    'parentId',
    'emitter',
    'emitterId'
  ),
  getObjectSchema('object'),
  getObjectSchema('metadata')
)

const fieldSchema = Joi.alternatives().try(
  getObjectSchema('object'),
  getObjectSchema('metadata')
)

// ////////// //
// 2020-08-10 //
// ////////// //
schemas['2020-08-10'] = {}
schemas['2020-08-10'].getHistory = {
  query: Joi.object().keys({
    // order
    order: Joi.string().valid('asc', 'desc').default('desc'),

    // pagination
    nbResultsPerPage: Joi.number().integer().min(1).max(100).default(DEFAULT_NB_RESULTS_PER_PAGE),
    startingAfter: Joi.string(),
    endingBefore: Joi.string(),

    // aggregation
    groupBy: Joi.string().valid('hour', 'day', 'month').required(),

    // filters
    id: getArrayFilter(Joi.string()),
    createdDate: getRangeFilter(Joi.string().isoDate()),
    type: getArrayFilter(Joi.string()),
    objectType: getArrayFilter(Joi.string()),
    objectId: getArrayFilter(Joi.string()),
    emitter: Joi.string().valid('core', 'custom', 'task'),
    emitterId: getArrayFilter(Joi.string())
  })
}
schemas['2020-08-10'].list = () => ({
  query: replaceOffsetWithCursorPagination(
    schemas['2019-05-20'].list.query
      .fork('orderBy', () => Joi.string().valid(...orderByFields).default('createdDate'))
  )
})

// ////////// //
// 2019-05-20 //
// ////////// //
schemas['2019-05-20'] = {}
// DEPRECATED:END
schemas['2019-05-20'].getStats = {
  query: Joi.object().keys({
    // order
    orderBy: Joi.string().valid('avg', 'count', 'sum', 'min', 'max').default('count'),
    order: Joi.string().valid('asc', 'desc').default('desc'),

    // pagination
    page: Joi.number().integer().min(1).default(1),
    nbResultsPerPage: Joi.number().integer().min(1).max(100).default(DEFAULT_NB_RESULTS_PER_PAGE),

    // aggregation
    groupBy: groupBySchema.required(),
    field: fieldSchema,
    avgPrecision: Joi.number().integer().min(0).default(2),

    // filters
    id: getArrayFilter(Joi.string()),
    createdDate: getRangeFilter(Joi.string().isoDate()),
    type: getArrayFilter(Joi.string()),
    objectType: getArrayFilter(Joi.string()),
    objectId: getArrayFilter(Joi.string()),
    emitter: Joi.string().valid('core', 'custom', 'task'),
    emitterId: getArrayFilter(Joi.string()),
    object: Joi.object().unknown(),
    metadata: Joi.object().unknown()
  })
}
// DEPRECATED:END
schemas['2019-05-20'].list = {
  query: Joi.object().keys({
    // order
    orderBy: Joi.string().valid(...oldPaginationOrderByFields).default('createdDate'),
    order: Joi.string().valid('asc', 'desc').default('desc'),

    // pagination
    page: Joi.number().integer().min(1).default(1),
    nbResultsPerPage: Joi.number().integer().min(1).max(100).default(DEFAULT_NB_RESULTS_PER_PAGE),

    // filters
    id: getArrayFilter(Joi.string()),
    createdDate: getRangeFilter(Joi.string().isoDate()),
    type: getArrayFilter(Joi.string()),
    objectType: getArrayFilter(Joi.string()),
    objectId: getArrayFilter(Joi.string()),
    emitter: Joi.string().valid('core', 'custom', 'task'),
    emitterId: getArrayFilter(Joi.string()),
    object: Joi.object().unknown(),
    metadata: Joi.object().unknown()
  })
}
schemas['2019-05-20'].read = {
  params: objectIdParamsSchema
}
schemas['2019-05-20'].create = {
  body: Joi.object().keys({
    type: Joi.string().required(),
    emitterId: Joi.string(),
    objectId: Joi.string(),
    metadata: Joi.object().unknown()
  }).required()
}

const validationVersions = {
  '2020-08-10': [
    {
      target: 'event.getHistory',
      schema: schemas['2020-08-10'].getHistory
    },
    {
      target: 'event.list',
      schema: schemas['2020-08-10'].list
    },
  ],

  '2019-05-20': [
    // DEPRECATED:END
    {
      target: 'event.getStats',
      schema: schemas['2019-05-20'].getStats
    },
    // DEPRECATED:END
    {
      target: 'event.list',
      schema: schemas['2019-05-20'].list
    },
    {
      target: 'event.read',
      schema: schemas['2019-05-20'].read
    },
    {
      target: 'event.create',
      schema: schemas['2019-05-20'].create
    },
  ]
}

module.exports = validationVersions
