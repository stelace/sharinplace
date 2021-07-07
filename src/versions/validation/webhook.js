const { Joi, objectIdParamsSchema, getRangeFilter, getArrayFilter } = require('../../util/validation')
const { apiVersions } = require('../util')
const { DEFAULT_NB_RESULTS_PER_PAGE } = require('../../util/pagination')

const schemas = {}

const webhookOrderByFields = [
  'createdDate',
  'updatedDate',
]

const webhookLogOrderByFields = [
  'createdDate',
]

// ////////// //
// 2020-08-10 //
// ////////// //
schemas['2020-08-10'] = {}
schemas['2020-08-10'].list = {
  query: Joi.object()
    .keys({
      // order
      orderBy: Joi.string().valid(...webhookOrderByFields).default('createdDate'),
      order: Joi.string().valid('asc', 'desc').default('desc'),

      // cursor pagination
      nbResultsPerPage: Joi.number().integer().min(1).max(100).default(DEFAULT_NB_RESULTS_PER_PAGE),
      startingAfter: Joi.string(),
      endingBefore: Joi.string(),

      // filters
      id: getArrayFilter(Joi.string()),
      createdDate: getRangeFilter(Joi.string().isoDate()),
      updatedDate: getRangeFilter(Joi.string().isoDate()),
      event: getArrayFilter(Joi.string()),
      active: Joi.boolean(),
    })
    .oxor('startingAfter', 'endingBefore')
}

schemas['2020-08-10'].listLogs = {
  query: Joi.object()
    .keys({
      // order
      orderBy: Joi.string().valid(...webhookLogOrderByFields).default('createdDate'),
      order: Joi.string().valid('asc', 'desc').default('desc'),

      // cursor pagination
      nbResultsPerPage: Joi.number().integer().min(1).max(100).default(DEFAULT_NB_RESULTS_PER_PAGE),
      startingAfter: Joi.string(),
      endingBefore: Joi.string(),

      // filters
      id: getArrayFilter(Joi.string()),
      createdDate: getRangeFilter(Joi.string().isoDate()),
      webhookId: getArrayFilter(Joi.string()),
      eventId: getArrayFilter(Joi.string()),
      status: getArrayFilter(Joi.string()),
    })
    .oxor('startingAfter', 'endingBefore')
}

schemas['2020-08-10'].readLog = {
  params: objectIdParamsSchema
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
    targetUrl: Joi.string().uri(),
    event: Joi.string(),
    apiVersion: Joi.string().valid(...apiVersions),
    active: Joi.boolean(),
    metadata: Joi.object().unknown(),
    platformData: Joi.object().unknown()
  }).required()
}
schemas['2019-05-20'].update = {
  params: objectIdParamsSchema,
  body: schemas['2019-05-20'].create.body
    .fork('targetUrl', schema => schema.forbidden())
    .fork('name', schema => schema.optional())
}
schemas['2019-05-20'].remove = {
  params: objectIdParamsSchema
}

const validationVersions = {
  '2020-08-10': [
    {
      target: 'webhook.list',
      schema: schemas['2020-08-10'].list
    },
    {
      target: 'webhook.listLogs',
      schema: schemas['2020-08-10'].listLogs
    },
    {
      target: 'webhook.readLog',
      schema: schemas['2020-08-10'].readLog
    },
  ],

  '2019-05-20': [
    {
      target: 'webhook.list',
      schema: schemas['2019-05-20'].list
    },
    {
      target: 'webhook.read',
      schema: schemas['2019-05-20'].read
    },
    {
      target: 'webhook.create',
      schema: schemas['2019-05-20'].create
    },
    {
      target: 'webhook.update',
      schema: schemas['2019-05-20'].update
    },
    {
      target: 'webhook.remove',
      schema: schemas['2019-05-20'].remove
    }
  ]
}

module.exports = validationVersions
