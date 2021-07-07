const { utils } = require('../../../serverTooling')
const { validation: { Joi } } = utils

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
      userId: getArrayFilter(Joi.string()),
      active: Joi.boolean()
    })
  }
  schemas['2019-05-20'].read = {
    params: objectIdParamsSchema
  }

  schemas['2019-05-20'].update = {
    params: objectIdParamsSchema,
    body: Joi.object().keys({
      name: Joi.string().max(255),
      active: Joi.boolean(),
      metadata: Joi.object().unknown(),
      platformData: Joi.object().unknown()
    }).required()
  }
  schemas['2019-05-20'].remove = {
    params: objectIdParamsSchema
  }

  const validationVersions = {
    '2020-08-10': [
      {
        target: 'savedSearch.list',
        schema: schemas['2020-08-10'].list
      },
    ],

    '2019-05-20': [
      {
        target: 'savedSearch.list',
        schema: schemas['2019-05-20'].list
      },
      // saved search creation validation schema is handled by core search service
      {
        target: 'savedSearch.read',
        schema: schemas['2019-05-20'].read
      },
      {
        target: 'savedSearch.update',
        schema: schemas['2019-05-20'].update
      },
      {
        target: 'savedSearch.remove',
        schema: schemas['2019-05-20'].remove
      }
    ]
  }

  return validationVersions
}
