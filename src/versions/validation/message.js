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
  'updatedDate'
]

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
    createdDate: getRangeFilter(Joi.string().isoDate()),
    updatedDate: getRangeFilter(Joi.string().isoDate()),
    userId: Joi.string(),
    senderId: Joi.string(),
    receiverId: Joi.string(),
    topicId: Joi.string(),
    conversationId: Joi.string()
  })
}
schemas['2019-05-20'].read = {
  params: objectIdParamsSchema
}
schemas['2019-05-20'].create = {
  body: Joi.object().keys({
    topicId: Joi.string().required(),
    conversationId: Joi.string(),
    content: Joi.string().allow('').max(3000).required(),
    attachments: Joi.array().items(Joi.object().unknown()),
    read: Joi.boolean(),
    senderId: Joi.string(),
    receiverId: Joi.string().required(),
    metadata: Joi.object().unknown(),
    platformData: Joi.object().unknown()
  }).required()
}
schemas['2019-05-20'].update = {
  params: objectIdParamsSchema,
  body: schemas['2019-05-20'].create.body
    .fork([
      'topicId',
      'conversationId',
      'content',
      'attachments',
      'senderId',
      'receiverId'
    ], schema => schema.forbidden())
}
schemas['2019-05-20'].remove = {
  params: objectIdParamsSchema
}

const validationVersions = {
  '2020-08-10': [
    {
      target: 'message.list',
      schema: schemas['2020-08-10'].list
    },
  ],

  '2019-05-20': [
    {
      target: 'message.list',
      schema: schemas['2019-05-20'].list
    },
    {
      target: 'message.read',
      schema: schemas['2019-05-20'].read
    },
    {
      target: 'message.create',
      schema: schemas['2019-05-20'].create
    },
    {
      target: 'message.update',
      schema: schemas['2019-05-20'].update
    },
    {
      target: 'message.remove',
      schema: schemas['2019-05-20'].remove
    }
  ]
}

module.exports = validationVersions
