const { builtInTypes, customTypeRegex } = require('stelace-util-keys')

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
  'updatedDate'
]

const typeSchema = Joi.alternatives().try(
  Joi.string().valid(...builtInTypes),
  Joi.string().regex(customTypeRegex)
)

const rightsSchema = Joi.when('type', {
  // https://github.com/hapijs/joi/blob/v14.3.1/API.md#anywhencondition-options
  is: Joi.string().valid(...builtInTypes).required(),
  then: Joi.strip(), // simply ignore for now
  otherwise: Joi.array().unique().items(Joi.string())
})
// Least surprise: throw when trying to customize a key with built-in type
// Update dashboard first
/*
const rightsSchema = Joi.when('type', {
  is: Joi.string().valid(...builtInTypes).required(),
  then: Joi.forbidden(),
  otherwise: Joi.array().unique().items(Joi.string())
})
*/

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
    type: typeSchema,
    reveal: Joi.number().integer().valid(0, 1)
  })
}
schemas['2019-05-20'].read = {
  params: objectIdParamsSchema,
  query: Joi.object().keys({
    reveal: Joi.number().integer().valid(0, 1)
  })
}
schemas['2019-05-20'].create = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    type: typeSchema,
    roles: rightsSchema,
    permissions: rightsSchema,
    readNamespaces: rightsSchema,
    editNamespaces: rightsSchema,
    metadata: Joi.object().unknown(),
    platformData: Joi.object().unknown()
  }).required()
}
schemas['2019-05-20'].update = {
  params: objectIdParamsSchema,
  body: schemas['2019-05-20'].create.body
    .fork('name', schema => schema.optional())
}
schemas['2019-05-20'].remove = {
  params: objectIdParamsSchema
}

const validationVersions = {
  '2020-08-10': [
    {
      target: 'apiKey.list',
      schema: schemas['2020-08-10'].list
    },
  ],

  '2019-05-20': [
    {
      target: 'apiKey.list',
      schema: schemas['2019-05-20'].list
    },
    {
      target: 'apiKey.read',
      schema: schemas['2019-05-20'].read
    },
    {
      target: 'apiKey.create',
      schema: schemas['2019-05-20'].create
    },
    {
      target: 'apiKey.update',
      schema: schemas['2019-05-20'].update
    },
    {
      target: 'apiKey.remove',
      schema: schemas['2019-05-20'].remove
    }
  ]
}

module.exports = validationVersions
