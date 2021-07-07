const {
  Joi,
  objectIdParamsSchema,
  getRangeFilter,
  getArrayFilter,
  replaceOffsetWithCursorPagination,
} = require('../../util/validation')
const { DEFAULT_NB_RESULTS_PER_PAGE } = require('../../util/pagination')

const organizationSchema = Joi.object().pattern(
  Joi.string(),
  Joi.object().keys({
    roles: Joi.array().unique().items(Joi.string())
  })
)

const orderByFields = [
  'createdDate',
  'updatedDate'
]

const oldPaginationOrderByFields = [
  'name',
  'createdDate',
  'updatedDate'
]

const userIdWithOrgIdSchema = Joi.object().keys({
  id: Joi.string().required(),
  organizationId: Joi.string().required()
}).required()

// Cannot make key forbidden or optional after using Joi.required() in Joi.when() 'otherwise' clause.
// alter and tailor methods are perfect for this use case:
// https://hapi.dev/family/joi/?v=16.1.7#anyaltertargets
const usernameOrPasswordSchema = Joi.string().alter({
  post: schema => schema.when('type', {
    is: 'organization',
    then: Joi.any().forbidden(),
    otherwise: Joi.string().max(255).required()
  }),
  patchUsername: schema => schema.optional(),
  patchPassword: schema => schema.forbidden()
})

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
schemas['2019-05-20'].checkAvailability = {
  query: Joi.object().keys({
    username: Joi.string().required()
  })
}
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
    query: Joi.string(),
    type: Joi.string().valid('organization', 'user', 'all'),
    userOrganizationId: getArrayFilter(Joi.string())
  })
}
schemas['2019-05-20'].read = {
  params: objectIdParamsSchema
}
schemas['2019-05-20'].create = {
  body: Joi.object().keys({
    type: Joi.string().valid('organization', 'user').default('user'),

    username: usernameOrPasswordSchema.tailor('post'),
    password: usernameOrPasswordSchema.tailor('post'),
    displayName: Joi.string().max(255).allow('', null),
    firstname: Joi.string().max(255).allow('', null),
    lastname: Joi.string().max(255).allow('', null),
    email: Joi.string().email().max(255).allow(null),
    description: Joi.string().max(3000).allow('', null),
    roles: Joi.array().unique().items(Joi.string()),
    organizations: organizationSchema,
    orgOwnerId: Joi.when('type', {
      is: 'organization',
      then: Joi.string().max(255),
      otherwise: Joi.any().forbidden()
    }),
    metadata: Joi.object().unknown(),
    platformData: Joi.object().unknown()
  }).required()
}
schemas['2019-05-20'].update = {
  params: objectIdParamsSchema,
  body: schemas['2019-05-20'].create.body
    .fork(['type', 'organizations', 'orgOwnerId'], schema => schema.forbidden())
    .fork('password', () => usernameOrPasswordSchema.tailor('patchPassword'))
    .fork('username', () => usernameOrPasswordSchema.tailor('patchUsername'))
    .keys({ orgOwnerId: Joi.string().max(255) })
}
schemas['2019-05-20'].remove = {
  params: objectIdParamsSchema
}
schemas['2019-05-20'].joinOrganizationOrUpdateRights = {
  params: userIdWithOrgIdSchema,
  body: Joi.object().keys({
    roles: Joi.array().unique().items(Joi.string())
  }).required()
}
schemas['2019-05-20'].removeFromOrganization = {
  params: userIdWithOrgIdSchema
}

const validationVersions = {
  '2020-08-10': [
    {
      target: 'user.list',
      schema: schemas['2020-08-10'].list
    },
  ],

  '2019-05-20': [
    {
      target: 'user.checkAvailability',
      schema: schemas['2019-05-20'].checkAvailability
    },
    {
      target: 'user.list',
      schema: schemas['2019-05-20'].list
    },
    {
      target: 'user.read',
      schema: schemas['2019-05-20'].read
    },
    {
      target: 'user.create',
      schema: schemas['2019-05-20'].create
    },
    {
      target: 'user.update',
      schema: schemas['2019-05-20'].update
    },
    {
      target: 'user.remove',
      schema: schemas['2019-05-20'].remove
    },

    // DEPRECATED:START in favor of PUT endpoint below (joinOrganizationOrUpdateRights)
    {
      target: 'user.updateOrganization',
      schema: schemas['2019-05-20'].joinOrganizationOrUpdateRights
    },
    // DEPRECATED:END
    {
      target: 'user.joinOrganizationOrUpdateRights',
      schema: schemas['2019-05-20'].joinOrganizationOrUpdateRights
    },
    {
      target: 'user.removeFromOrganization',
      schema: schemas['2019-05-20'].removeFromOrganization
    }
  ]
}

module.exports = validationVersions
