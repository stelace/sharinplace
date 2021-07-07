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

const oldPaginationOrderByFields = [
  'name',
  'createdDate',
  'updatedDate'
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
    id: getArrayFilter(Joi.string())
  })
}
schemas['2019-05-20'].read = {
  params: objectIdParamsSchema
}
schemas['2019-05-20'].create = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    type: Joi.string().valid('number', 'boolean', 'text', 'select', 'tags').required(),
    listValues: Joi.array().items(Joi.string()),
    metadata: Joi.object().unknown(),
    platformData: Joi.object().unknown()
  }).required()
}
schemas['2019-05-20'].update = {
  params: objectIdParamsSchema,
  body: schemas['2019-05-20'].create.body
    .fork(['name', 'type'], schema => schema.forbidden())
}
schemas['2019-05-20'].remove = {
  params: objectIdParamsSchema
}

const validationVersions = {
  '2020-08-10': [
    {
      target: 'customAttribute.list',
      schema: schemas['2020-08-10'].list
    },
  ],

  '2019-05-20': [
    {
      target: 'customAttribute.list',
      schema: schemas['2019-05-20'].list
    },
    {
      target: 'customAttribute.read',
      schema: schemas['2019-05-20'].read
    },
    {
      target: 'customAttribute.create',
      schema: schemas['2019-05-20'].create
    },
    {
      target: 'customAttribute.update',
      schema: schemas['2019-05-20'].update
    },
    {
      target: 'customAttribute.remove',
      schema: schemas['2019-05-20'].remove
    }
  ]
}

module.exports = validationVersions
