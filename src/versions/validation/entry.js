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

const localeSchema = Joi.string().regex(/^[a-z_-]+$/i).max(255)

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

    collection: getArrayFilter(Joi.string()),
    locale: getArrayFilter(Joi.string()),
    name: getArrayFilter(Joi.string())
  }).required()
}
schemas['2019-05-20'].read = {
  params: objectIdParamsSchema
}
schemas['2019-05-20'].create = {
  body: Joi.object().keys({
    collection: Joi.string().required(),
    locale: localeSchema.required(),
    name: Joi.string().required(),
    fields: Joi.object().unknown(),
    metadata: Joi.object().unknown()
  }).required()
}
schemas['2019-05-20'].update = {
  params: objectIdParamsSchema,
  body: schemas['2019-05-20'].create.body
    .fork(['collection', 'locale', 'name'], schema => schema.optional())
}
schemas['2019-05-20'].remove = {
  params: objectIdParamsSchema
}

const validationVersions = {
  '2020-08-10': [
    {
      target: 'entry.list',
      schema: schemas['2020-08-10'].list
    },
  ],

  '2019-05-20': [
    {
      target: 'entry.list',
      schema: schemas['2019-05-20'].list
    },
    {
      target: 'entry.read',
      schema: schemas['2019-05-20'].read
    },
    {
      target: 'entry.create',
      schema: schemas['2019-05-20'].create
    },
    {
      target: 'entry.update',
      schema: schemas['2019-05-20'].update
    },
    {
      target: 'entry.remove',
      schema: schemas['2019-05-20'].remove
    }
  ]
}

module.exports = validationVersions
