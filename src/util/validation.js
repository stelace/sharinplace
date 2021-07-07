/* eslint-disable camelcase */

const Joi = require('@hapi/joi')
const Bourne = require('@hapi/bourne')

const {
  getRandomStringRegex,
  objectIdLength,
  extractDataFromObjectId,
  platformZones
} = require('stelace-util-keys')

const UUID_V4_REGEX = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i

function isUUIDV4 (value) {
  return typeof value === 'string' && UUID_V4_REGEX.test(value)
}

/**
 * Joi does not coerce strings to objects and arrays anymore since v16
 * so we restore this behavior manually.
 * https://github.com/hapijs/joi/issues/2037, "Array and object string coercion"
 */
const customJoi = Joi.extend(
  {
    type: 'object',
    base: Joi.object(),
    coerce: {
      from: 'string',
      method (value, helpers) {
        if (typeof value !== 'string') return
        if (value[0] !== '{' && !/^\s*\{/.test(value)) return

        try {
          return { value: Bourne.parse(value) }
        } catch (ignoreErr) { }
      }
    }
  },
  {
    type: 'array',
    base: Joi.array(),
    coerce: {
      from: 'string',
      method (value, helpers) {
        if (typeof value !== 'string') return
        if (value[0] !== '[' && !/^\s*\[/.test(value)) return

        try {
          return { value: Bourne.parse(value) }
        } catch (ignoreErr) { }
      }
    }
  }
)

/**
 * Tests if given id is in-house objectId
 * @param {Object} params
 * @param {String} params.id - id to test
 * @param {String} [params.platformId] - if passed, objectId should have it encoded
 * @param {String} [params.prefix=''] - in-house objectId prefix like 'ast'
 * @param {String} [params.env='test'] - 'live' can change the format
 * @return {Boolean}
 */
function isValidObjectId ({ id, prefix = '', env = 'test', platformId, unitTest }) {
  let hasValidFormat
  let validPlatformId
  let hasValidTimestamp
  let hasValidZone
  const objectIdRegex = getRandomStringRegex(objectIdLength, { prefix, env })

  if (!id || ![objectIdLength, 36].includes(id.length)) return false

  try {
    const extractedData = extractDataFromObjectId(id)
    const decodedPlatformId = extractedData.platformId
    const decodedDate = new Date((extractedData.timestamp || 0) * 1000)
    // All test objects (except for some assets) have ids ending in 'Qps1I3a1gJYz2I3a'
    // whose encoded platformId is '1'.
    // Ignore this exception for unit tests so that we can also check real behavior.
    const realPlatformId = (process.env.NODE_ENV === 'test' && !unitTest) ? '1' : platformId

    validPlatformId = platformId ? realPlatformId === decodedPlatformId : true
    hasValidFormat = objectIdRegex.test(id) && typeof decodedPlatformId === 'string'
    hasValidTimestamp = decodedDate.getFullYear() >= 2018 &&
      decodedDate.getTime() < Date.now() + 1000 // (before next second due to timestamp rounding)
    hasValidZone = typeof extractedData.zone === 'string' &&
      platformZones.includes(extractedData.zone.toLowerCase())
  } catch (e) {
    return false
  }

  return hasValidFormat && hasValidTimestamp && hasValidZone && validPlatformId
}

const objectIdParamsSchema = customJoi.object().keys({
  id: customJoi.string().required()
}).required()

function getRangeFilter (joiType) {
  const rangeSchema = customJoi.object().pattern(
    customJoi.string().valid('lt', 'lte', 'gt', 'gte'),
    joiType
  )

  return customJoi.alternatives().try(
    joiType,
    rangeSchema
      .oxor('lt', 'lte')
      .oxor('gt', 'gte')
  )
}

function getArrayFilter (joiType) {
  return customJoi.alternatives().try(
    joiType,
    Joi.array().unique().items(joiType),
  )
}

const idsSchema = customJoi.array().unique().items(customJoi.string()).single()

const locationSchema = customJoi.object().unknown().keys({
  latitude: customJoi.number().min(-90).max(90).required(),
  longitude: customJoi.number().min(-180).max(180).required()
})

const sortSchema = customJoi.array().items(
  customJoi.object().length(1).pattern(/.*/, customJoi.string().allow('desc', 'asc'))
).single() // converts unique {sortStep} to [{sortStep}]

const availabilityFilterSchema = customJoi.object().keys({
  enabled: customJoi.boolean(),
  fullPeriod: customJoi.boolean(),
  unavailableWhen: [
    customJoi.string().allow(null),
    customJoi.array().items(customJoi.string()).allow(null)
  ],
})

const searchSchema = customJoi.object().keys({
  query: customJoi.string().allow(''),
  categoryId: idsSchema,
  assetTypeId: idsSchema,
  location: locationSchema,
  maxDistance: customJoi.number().integer().min(1),
  startDate: customJoi.string().isoDate(),
  endDate: customJoi.string().isoDate(),
  quantity: customJoi.number().integer().min(1),
  without: idsSchema,
  similarTo: idsSchema,
  page: customJoi.number().integer().min(1),
  nbResultsPerPage: customJoi.number().integer().min(1).max(100),
  customAttributes: customJoi.object(),
  filter: customJoi.string().max(512),
  validated: customJoi.boolean(),
  // Active filter can now be inverted with false value or ignored with null value
  active: customJoi.boolean().allow(null),
  // Add sort array/object
  sort: sortSchema,
  availabilityFilter: availabilityFilterSchema,

  createdBefore: customJoi.string().isoDate().allow(null),
  createdAfter: customJoi.string().isoDate().allow(null)
})

function replaceOffsetWithCursorPagination (schema) {
  return schema
    .fork('page', schema => schema.forbidden())
    .keys({
      startingAfter: customJoi.string(),
      endingBefore: customJoi.string(),
    })
    .oxor('startingAfter', 'endingBefore')
}

module.exports = {
  Joi: customJoi,
  isUUIDV4,
  isValidObjectId,

  objectIdParamsSchema,
  searchSchema,
  getRangeFilter,
  getArrayFilter,
  replaceOffsetWithCursorPagination,
}
