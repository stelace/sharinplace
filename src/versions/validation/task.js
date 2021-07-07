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
  'updatedDate',
]

const oldPaginationOrderByFields = [
  'name',
  'createdDate',
  'updatedDate',
  'quantity',
  'price',
  'validated',
  'active'
]

const schemas = {}

// ////////// //
// 2020-08-10 //
// ////////// //
schemas['2020-08-10'] = {}
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
    updatedDate: getRangeFilter(Joi.string().isoDate()),
    eventType: getArrayFilter(Joi.string()),
    eventObjectId: getArrayFilter(Joi.string()),
    active: Joi.boolean()
  })
}
schemas['2019-05-20'].read = {
  params: objectIdParamsSchema
}
schemas['2019-05-20'].create = {
  body: Joi.object().keys({
    executionDate: Joi.string().isoDate().allow(null),
    recurringPattern: Joi.string().allow(null),
    recurringTimezone: Joi.string().allow(null),
    eventType: Joi.string().required(),
    eventMetadata: Joi.object().unknown(),
    eventObjectId: Joi.string().allow(null),
    active: Joi.boolean(),
    metadata: Joi.object().unknown(),
    platformData: Joi.object().unknown()
  }).required()
}
schemas['2019-05-20'].update = {
  params: objectIdParamsSchema,
  body: schemas['2019-05-20'].create.body
    .fork('eventType', schema => schema.optional())
}
schemas['2019-05-20'].remove = {
  params: objectIdParamsSchema
}

const validationVersions = {
  '2020-08-10': [
    {
      target: 'task.list',
      schema: schemas['2020-08-10'].list
    },
  ],

  '2019-05-20': [
    {
      target: 'task.list',
      schema: schemas['2019-05-20'].list
    },
    {
      target: 'task.read',
      schema: schemas['2019-05-20'].read
    },
    {
      target: 'task.create',
      schema: schemas['2019-05-20'].create
    },
    {
      target: 'task.update',
      schema: schemas['2019-05-20'].update
    },
    {
      target: 'task.remove',
      schema: schemas['2019-05-20'].remove
    }
  ]
}

module.exports = validationVersions
