const { computeDate, isDateString, truncateDate } = require('../src/util/time')
const { getModels } = require('../src/models')
const { roundDecimal, sumDecimals } = require('../src/util/math')
const WebhookManager = require('./webhook-manager')
const _ = require('lodash')
const request = require('supertest')
const qs = require('querystring')

/**
 * May be required to let event propagate before moving on with current test
 * @constant {Number} testEventDelay
 * @default
 */
const testEventDelay = 1000 // ms

module.exports = {
  testEventDelay,
  WebhookManager,

  computeDate,
  nullOrUndefinedFallback,
  getObjectEvent,
  testEventMetadata,

  checkCursorPaginationScenario,
  checkCursorPaginatedListObject,
  checkCursorPaginatedStatsObject,
  checkCursorPaginatedHistoryObject,

  checkOffsetPaginationScenario,
  checkOffsetPaginatedListObject,
  checkOffsetPaginatedStatsObject,

  checkFilters,
}

/**
 * Checks if value is undefined or null and returns the value if it is not, fallbackValue otherwise.
 * @param {Any} value
 * @param {Any} fallbackValue
 * @return {Any} value or fallback
 */
function nullOrUndefinedFallback (value, fallbackValue) {
  return (typeof value === 'undefined' || value === null) ? fallbackValue : value
}

/**
 * Finds first event of given type related to a single object
 * @param {Object} params
 * @param {Array} params.events - Array of Event objects
 * @param {String} params.eventType - like 'asset__created'
 * @param {String} params.objectId
 * @return {Object} Event object
 */
function getObjectEvent ({ events, eventType, objectId }) {
  if (_.isEmpty(events)) throw new Error('No events to search for object event')
  return events.find(event => event.type === eventType && event.objectId === objectId)
}

/**
 * Includes boilerplate Event tests
 * @param {Object} params
 * @param {Object} params.t - Test execution object like ava’s 't'
 * @param {Object} params.event - event Object
 * @param {Object} params.object - Object to compare as a reference
 * @param {Object} [params.metadata] - expected event.metadata
 * @param {Object} [params.relatedObjectsIds] - Needed for related ids not root properties of `object`
 * @param {Object} [params.patchPayload] - If testing update
 * @return {Object} Event object
 */
async function testEventMetadata ({
  t,
  event,
  object,
  metadata,
  relatedObjectsIds,
  patchPayload
}) {
  const { Event } = await getModels({
    platformId: t.context.platformId,
    env: t.context.env
  })
  const shouldHaveChangesRegex = Event.hasChangesRequested
  const shouldHaveObjectRegex = Event.hasObjectRegex
  const shouldHaveRelatedObjectsIdsRegex = Event.hasRelatedObjectsIdsRegex

  if (!t || typeof t.fail !== 'function') throw new Error('Missing test execution object')
  if (_.isEmpty(event)) t.fail('Missing event')
  if (_.isEmpty(object)) t.fail('Missing object')
  if (!event.type) t.fail(`Missing event type, id: ${event.id}`)
  if (shouldHaveChangesRegex.test(event.type) && _.isUndefined(patchPayload)) {
    t.fail(`Missing patchPayload for ${event.type} event`)
  }

  const testMessage = event.type
  const objectType = event.objectType || _.camelCase(event.type.split('__')[0])
  const relatedIds = Object.assign(_.pick(object, Event.relatedObjectsWhitelist), relatedObjectsIds)
  const shouldHaveObject = shouldHaveObjectRegex.test(event.type)
  const shouldHaveRelatedObjectsIds = shouldHaveRelatedObjectsIdsRegex.test(event.type)
  const shouldHaveChangesRequested = shouldHaveChangesRegex.test(event.type)

  t.truthy(event, testMessage)
  t.is(event.objectId, object.id, testMessage)
  t.is(event.objectType, objectType, testMessage)

  if (shouldHaveObject) {
    t.true(event.object.id === object.id, testMessage)
    t.deepEqual(event.object.metadata, object.metadata)
    t.deepEqual(event.object.platformData, object.platformData)
  } else t.true(event.object === null, testMessage)

  const changesRequested = event.changesRequested

  if (shouldHaveChangesRequested) t.deepEqual(changesRequested, patchPayload, testMessage)
  else t.true(event.changesRequested === null, testMessage)

  if (shouldHaveRelatedObjectsIds) t.deepEqual(event.relatedObjectsIds, relatedIds, testMessage)
  else t.true(event.relatedObjectsIds === null, testMessage)

  if (metadata) t.deepEqual(event.metadata, metadata, testMessage)
}

function checkCursorPaginatedListObject (t, obj, { checkResultsFn, cursorCheck = true } = {}) {
  t.true(_.isPlainObject(obj))
  t.true(_.isNumber(obj.nbResultsPerPage))
  t.true(_.isBoolean(obj.hasPreviousPage))
  t.true(_.isBoolean(obj.hasNextPage))
  t.true(Array.isArray(obj.results))

  if (obj.results.length) {
    if (cursorCheck) {
      t.true(_.isString(obj.startCursor))
      t.true(_.isString(obj.endCursor))
    }
  } else {
    t.is(obj.startCursor, null)
    t.is(obj.endCursor, null)
  }

  if (_.isFunction(checkResultsFn)) obj.results.forEach(r => checkResultsFn(t, r))
}

async function checkCursorPaginationScenario ({
  t,
  endpointUrl,
  authorizationHeaders,
  orderBy = 'createdDate',
  checkResultsFn,
  passOrderByToQuery = true,
  nbResultsPerPage = 2, // small number to be able to fetch several pages
}) {
  const isPaginationObject = obj => {
    checkCursorPaginatedListObject(t, obj, checkResultsFn)
  }

  const orders = ['desc', 'asc']

  for (const order of orders) {
    let previousValue
    const checkOrder = (results) => {
      results.forEach(r => {
        if (!_.isUndefined(previousValue)) {
          if (order === 'desc') t.true(r[orderBy] <= previousValue)
          else t.true(r[orderBy] >= previousValue)
        }

        previousValue = r[orderBy]
      })
    }

    const queryParams = {
      nbResultsPerPage,
      order,
    }

    if (passOrderByToQuery) queryParams.orderBy = orderBy

    // ////////// //
    // FIRST PAGE //
    // ////////// //
    let filters = qs.stringify(queryParams)

    const getEndpoint = (endpointUrl, filters) => {
      if (endpointUrl.includes('?')) return `${endpointUrl}&${filters}`
      else return `${endpointUrl}?${filters}`
    }

    const { body: page1Obj } = await request(t.context.serverUrl)
      .get(getEndpoint(endpointUrl, filters))
      .set(authorizationHeaders)
      .expect(200)

    isPaginationObject(page1Obj)
    checkOrder(page1Obj.results)

    // stop here if there is only one page
    if (!page1Obj.hasNextPage) return

    // /////////// //
    // SECOND PAGE //
    // /////////// //
    filters = qs.stringify({
      ...queryParams,
      startingAfter: page1Obj.endCursor,
    })

    const { body: page2Obj } = await request(t.context.serverUrl)
      .get(getEndpoint(endpointUrl, filters))
      .set(authorizationHeaders)
      .expect(200)

    isPaginationObject(page2Obj)
    checkOrder(page2Obj.results)
    t.is(_.intersectionWith(page1Obj.results, page2Obj.results, _.isEqual).length, 0)

    t.true(page2Obj.hasPreviousPage)

    // //////////////// //
    // FIRST PAGE AGAIN //
    // //////////////// //
    filters = qs.stringify({
      ...queryParams,
      endingBefore: page2Obj.startCursor,
    })

    const { body: page1ObjAgain } = await request(t.context.serverUrl)
      .get(getEndpoint(endpointUrl, filters))
      .set(authorizationHeaders)
      .expect(200)

    isPaginationObject(page1ObjAgain)
    t.true(page1ObjAgain.hasNextPage)

    t.deepEqual(page1Obj, page1ObjAgain)
  }
}

function checkOffsetPaginatedListObject (t, obj, { checkResultsFn } = {}) {
  t.true(_.isPlainObject(obj))
  t.true(_.isNumber(obj.nbResults))
  t.true(_.isNumber(obj.nbPages))
  t.true(_.isNumber(obj.page))
  t.true(_.isNumber(obj.nbResultsPerPage))
  t.true(Array.isArray(obj.results))

  if (obj.nbPages === 1) t.is(obj.results.length, obj.nbResults)
  if (_.isFunction(checkResultsFn)) obj.results.forEach(r => checkResultsFn(t, r))
}

async function checkOffsetPaginationScenario ({
  t,
  endpointUrl,
  authorizationHeaders,
  checkResultsFn,
  orderBy = 'createdDate',
  nbResultsPerPage = 2, // small number to be able to fetch several pages
}) {
  const isPaginationObject = obj => {
    checkOffsetPaginatedListObject(t, obj, checkResultsFn)
  }

  const orders = ['desc', 'asc']

  for (const order of orders) {
    let previousValue
    const checkOrder = (results) => {
      results.forEach(r => {
        if (!_.isUndefined(previousValue)) {
          if (order === 'desc') t.true(r[orderBy] <= previousValue)
          else t.true(r[orderBy] >= previousValue)
        }

        previousValue = r[orderBy]
      })
    }

    // ////////// //
    // FIRST PAGE //
    // ////////// //
    let filters = qs.stringify({
      page: 1,
      nbResultsPerPage,
      orderBy,
      order,
    })

    const getEndpoint = (endpointUrl, filters) => {
      if (endpointUrl.includes('?')) return `${endpointUrl}&${filters}`
      else return `${endpointUrl}?${filters}`
    }

    const { body: page1Obj } = await request(t.context.serverUrl)
      .get(getEndpoint(endpointUrl, filters))
      .set(authorizationHeaders)
      .expect(200)

    isPaginationObject(page1Obj)
    checkOrder(page1Obj.results)

    // stop here if there is only one page
    if (page1Obj.nbPages <= 1) return

    // /////////// //
    // SECOND PAGE //
    // /////////// //
    filters = qs.stringify({
      page: 2,
      nbResultsPerPage,
      orderBy,
      order,
    })

    const { body: page2Obj } = await request(t.context.serverUrl)
      .get(getEndpoint(endpointUrl, filters))
      .set(authorizationHeaders)
      .expect(200)

    isPaginationObject(page2Obj)
    checkOrder(page2Obj.results)

    // //////////////// //
    // FIRST PAGE AGAIN //
    // //////////////// //
    filters = qs.stringify({
      page: 1,
      nbResultsPerPage,
      orderBy,
      order,
    })

    const { body: page1ObjAgain } = await request(t.context.serverUrl)
      .get(getEndpoint(endpointUrl, filters))
      .set(authorizationHeaders)
      .expect(200)

    isPaginationObject(page1ObjAgain)

    t.deepEqual(page1Obj, page1ObjAgain)
  }
}

/**
 * @param {Object}   params
 * @param {Object}   params.t - AVA test object
 * @param {Object}   params.obj - stats object returned by API
 * @param {String}   params.groupBy
 * @param {String}   [params.field]
 * @param {Object[]} params.results
 * @param {Boolean}  [params.expandedGroupByField = true]
 *   if false, result has no `groupBy` and `groupByValue`
 *   if true, result has property [`groupBy`] with `groupByValue` as value
 *   true: { groupBy: ..., groupByValue: ... }
 *   false: { [groupBy]: groupByValue }
 * @param {Number}   [avgPrecision = 2] - check the average precision
 * @param {String}   [orderBy = 'count']
 * @param {String}   [order = 'desc']
 * @param {Function} [additionalResultCheckFn] - if defined, will perform additional check
 *     on each item of results array
 */
function checkStatsObject ({
  t,
  obj,
  groupBy,
  field,
  results,
  expandedGroupByField = true,
  avgPrecision = 2,
  orderBy = 'count',
  order = 'desc',
  additionalResultCheckFn
}) {
  // only consider results whose `groupBy` value is not `undefined`
  results = results.filter(e => !_.isUndefined(_.get(e, groupBy)))
  const resultsByType = _.groupBy(results, groupBy)

  obj.results.forEach(result => {
    const key = expandedGroupByField ? result.groupByValue : result[groupBy]
    const results = resultsByType[key] || []
    const count = results.length

    const nullIfNone = (count, nb) => count === 0 ? null : nb

    const sum = nullIfNone(count, sumDecimals(_.compact(results.map(r => _.get(r, field)))))
    const avg = nullIfNone(count, sum / results.length)
    const min = nullIfNone(count, results.reduce((nb, r) => Math.min(_.get(r, field), nb), _.get(results[0], field)))
    const max = nullIfNone(count, results.reduce((nb, r) => Math.max(_.get(r, field), nb), _.get(results[0], field)))

    if (expandedGroupByField) {
      t.is(result.groupBy, groupBy)
      t.is(typeof result.groupByValue, 'string')
    } else {
      t.is(typeof result[groupBy], 'string')
    }

    t.is(result.count, count)

    if (field) {
      t.is(result.avg, roundDecimal(avg, avgPrecision))

      // Better compare the difference below a small threshold
      // than performing a strict equality because of floating operation precision
      // 8.1 + 8.2 = 16.299999999999997
      const isEqual = (nb1, nb2) => Math.abs(nb1 - nb2) <= 1e-4 // not using Number.EPSILON because it's too small
      t.true(isEqual(result.sum, sum))

      t.is(result.min, min)
      t.is(result.max, max)
    } else {
      t.is(result.avg, null)
      t.is(result.sum, null)
      t.is(result.min, null)
      t.is(result.max, null)
    }
  })

  const totalCount = obj.results.reduce((total, r) => total + r.count, 0)
  t.is(totalCount, results.length)

  // check order
  let number
  obj.results.forEach(result => {
    if (typeof number === 'undefined') {
      number = result[orderBy]
    } else {
      if (order === 'desc') t.true(number >= result[orderBy])
      else t.true(number <= result[orderBy])

      number = result[orderBy]
    }

    if (typeof additionalResultCheckFn === 'function') {
      additionalResultCheckFn(result)
    }
  })
}

// Please refer to checkStatsObject for parameters list
function checkOffsetPaginatedStatsObject (params) {
  const { t, obj } = params

  checkStatsObject(params)
  checkOffsetPaginatedListObject(t, obj)
}

// Please refer to checkStatsObject for parameters list
function checkCursorPaginatedStatsObject (params) {
  const { t, obj } = params

  checkStatsObject(params)
  checkCursorPaginatedListObject(t, obj)
}

/**
 * @param {Object}   params
 * @param {Object}   params.t - AVA test object
 * @param {Object}   params.obj - stats object returned by API
 * @param {String}   params.groupBy
 * @param {Object[]} params.results
 * @param {String}   [order = 'desc']
 * @param {Function} [additionalResultCheckFn] - if defined, will perform additional check on `result`
 */
function checkCursorPaginatedHistoryObject ({
  t,
  obj,
  groupBy,
  results,
  order = 'desc',
  additionalResultCheckFn
}) {
  const resultsByType = _.groupBy(results, result => {
    const date = result.createdDate

    if (groupBy === 'hour') return date.slice(0, 14) + '00:00.000Z'
    else if (groupBy === 'day') return truncateDate(date)

    // month time unit isn't supported in TimescaleDB
    // and we approximate it as '30 days'
    // which makes impossible to group like TimescaleDB
    else if (groupBy === 'month') return date
  })

  checkCursorPaginatedListObject(t, obj)

  obj.results.forEach(result => {
    const key = result[groupBy]
    const results = resultsByType[key] || []
    const count = results.length

    t.true(isDateString(result[groupBy]))

    // month time unit isn't supported in TimescaleDB
    if (groupBy !== 'month') {
      t.is(result.count, count)
    }
  })

  const totalCount = obj.results.reduce((total, r) => total + r.count, 0)
  t.is(totalCount, results.length)

  // check order
  const orderBy = groupBy
  let date
  obj.results.forEach(result => {
    if (typeof date === 'undefined') {
      date = result[orderBy]
    } else {
      if (order === 'desc') t.true(date >= result[orderBy])
      else t.true(date <= result[orderBy])

      date = result[orderBy]
    }

    if (typeof additionalResultCheckFn === 'function') {
      additionalResultCheckFn(result)
    }
  })
}

/**
 * Util to check list/stats endpoint filters works as expected
 * 3 types of filters are supported:
 * - exact value filter
 * - array filter
 * - range filter
 *
 * If test values aren't provided, values will be automatically fetched from fixtures.
 *
 * Each filter will be tested with values according to their type to check
 * that validation step is triggered, and that returned results are effectively filtered.
 *
 * Please note that the exact value check will also apply to array/range filters.
 *
 * @param {Object}   params
 * @param {Object}   params.t - AVA test object
 * @param {Object}   params.authorizationHeaders
 * @param {String}   params.endpointUrl - tested endpoint
 * @param {String}   [params.fetchEndpointUrl] - if not specified, fallback to endpointUrl
 *   is the endpoint to hit to auto-generate test values
 *   (useful to specify it for stats and history endpoints)
 * @param {Function} [params.checkPaginationObject(t, obj)]
 * @param {Object[]} params.filters
 * @param {String}   params.filters[i].prop
 * @param {Function} [params.filters[i].customGetValue(obj)]
 *   custom getter to value with prop (by default obj[prop])
 *
 * Custom check filter functions, one by filter type
 * `getValue(obj)` is the result of the getter function (obj[prop] or customGetValue(obj))
 * @param {Function} [params.filters[i].customExactValueFilterCheck(obj, value)]
 *  where value is a primitive type
 *  default: (obj, value) => getValue(obj) === exactValue
 * @param {Function} [params.filters[i].customArrayFilterCheck(obj, values)]
 *  where values is an array
 *  default: (obj, value) => values.includes(getValue(obj))
 * @param {Function} [params.filters[i].customRangeFilterCheck(obj, rangeValues, isWithinRange)]
 *  where rangeValues is an object with the following properties: `gt` or `gte`, and `lt` or `lte`
 *  and isWithinRange is a helper function to check range
 *  default: isWithinRange(getValue(obj), rangeValues)
 *
 * @param {Boolean}  [params.filters[i].isArrayFilter = false] - optional if customArrayFilterCheck provided
 * @param {Boolean}  [params.filters[i].isRangeFilter = false] - optional if customRangeFilterCheck provided
 * @param {Object[]} [params.filters[i].customTestValues] - if specified, will only use those values
 *   and test each one of those values
 *   otherwise, will perform a fetch of objects and test with fixtures values
 * @param {Boolean}  [params.filters[i].noResultsExistenceCheck = false]
 *   by default, will check if there are results while it should have (based on auto-fetched values)
 */
async function checkFilters ({
  t,
  authorizationHeaders,
  endpointUrl,
  fetchEndpointUrl,
  checkPaginationObject,
  filters,
}) {
  const getEndpoint = (endpointUrl, queryParams) => {
    if (endpointUrl.includes('?')) return `${endpointUrl}&${queryParams}`
    else return `${endpointUrl}?${queryParams}`
  }

  // prop=value
  const getExactValueFilter = (prop, exactValue) => `${prop}=${exactValue}`

  // prop[]=value1&prop[]=value2
  const getArrayValuesFilter = (prop, values) => values.map(v => `${prop}[]=${v}`).join('&')

  // prop=value1,value2
  const getArrayCommaSeparatedValuesFilter = (prop, values) => `${prop}=${values.join(',')}`

  // prop[gte]=min&prop[lte]=max or any combinations with `gt` or `gte`, and `lt` or `lte`
  const getRangeFilter = (prop, range, isEqualToMin, isEqualToMax) => {
    return `${prop}[${isEqualToMin ? 'gte' : 'gt'}]=${range.min}&${prop}[${isEqualToMax ? 'lte' : 'lt'}]=${range.max}`
  }

  // prop[gt]=min&prop[gte]=min
  const getInvalidGreaterThanRangeFilter = (prop, range) => `${prop}[gt]=${range.gte}&${prop}[gte]=${range.gte}`

  // prop[lt]=min&prop[lte]=min
  const getInvalidLesserThanRangeFilter = (prop, range) => `${prop}[lt]=${range.lte}&${prop}[lte]=${range.lte}`

  const isWithinRange = (value, rangeValues) => {
    let result = true

    if (rangeValues.gte) result = result && rangeValues.gte <= value
    if (rangeValues.gt) result = result && rangeValues.gt < value
    if (rangeValues.lte) result = result && value <= rangeValues.lte
    if (rangeValues.lt) result = result && value < rangeValues.lt

    return result
  }

  // prepare check result object functions by selecting default check or custom check function
  const addCheckResultObjFunctions = (filter) => {
    const {
      prop,
      customGetValue,
      isArrayFilter,
      isRangeFilter,

      customExactValueFilterCheck,
      customArrayFilterCheck,
      customRangeFilterCheck,
    } = filter

    const getValue = (obj) => _.isFunction(customGetValue) ? customGetValue(obj) : obj[prop]
    filter.getValue = getValue

    filter.shouldCheckArrayFilter = isArrayFilter || _.isFunction(customArrayFilterCheck)
    filter.shouldCheckRangeFilter = isRangeFilter || _.isFunction(customRangeFilterCheck)

    // checks exact value filter returns objects whose property matches the filter value
    filter.getExactValueCheckFn = _.curry((exactValue, obj) => {
      return _.isFunction(customExactValueFilterCheck)
        ? customExactValueFilterCheck(obj, exactValue)
        : getValue(obj) === exactValue
    })

    if (filter.shouldCheckArrayFilter) {
      // checks array filter returns objects whose property is included into filter values
      filter.getArrayValuesCheckFn = _.curry((values, obj) => {
        return _.isFunction(customArrayFilterCheck)
          ? customArrayFilterCheck(obj, values)
          : values.includes(getValue(obj))
      })
    } else if (filter.shouldCheckRangeFilter) {
      // checks range filter returns objects whose property is included into the range filter
      filter.getRangeValuesCheckFn = _.curry((rangeValues, obj) => {
        return _.isFunction(customRangeFilterCheck)
          ? customRangeFilterCheck(obj, rangeValues, isWithinRange) // pass util function
          : isWithinRange(getValue(obj), rangeValues)
      })
    }
  }

  // compute test values filter based on fixtures or on provided filter property `customTestValues`
  const setFilterTestValues = (filter, realResults) => {
    const {
      shouldCheckArrayFilter,
      shouldCheckRangeFilter,
      customTestValues,
    } = filter

    addCheckResultObjFunctions(filter)

    const getValue = filter.getValue

    const useCustomValues = customTestValues && customTestValues.length

    const realValues = _.compact(_.uniq(realResults.map(getValue)))
    const testValues = _.shuffle(useCustomValues ? customTestValues : realValues)

    filter.shouldHaveResults = !useCustomValues && Boolean(realValues.length)

    if (useCustomValues) filter.testExactValues = testValues

    // number of different values from fixtures can be high
    else filter.testExactValues = testValues.slice(0, 10) // values were shuffled

    // pick only few values for filter to ensure the filter works
    // selecting too many values may trigger a request for all results
    if (shouldCheckArrayFilter && testValues.length) filter.testArrayValues = testValues.slice(0, 2)

    if (shouldCheckRangeFilter && testValues.length) {
      if (testValues.length === 1) {
        const value = _.first(testValues)

        filter.testRangeValues = {
          min: value,
          max: value,
        }
      } else {
        const [value1, value2] = testValues // values were shuffled

        // do not use Math.(min|max) as the type can be string
        const min = value1 < value2 ? value1 : value2
        const max = value1 > value2 ? value1 : value2

        filter.testRangeValues = {
          min,
          max,
        }
      }
    }
  }

  const maxNbResultsPerPage = 100

  if (!fetchEndpointUrl) fetchEndpointUrl = endpointUrl

  // fetch the objects to automatically get the different values for the filters
  const { body: { results } } = await request(t.context.serverUrl)
    .get(getEndpoint(fetchEndpointUrl, `nbResultsPerPage=${maxNbResultsPerPage}`))
    .set(authorizationHeaders)
    .expect(200)

  for (const filter of filters) {
    setFilterTestValues(filter, results)
  }

  const testCases = []

  for (const filter of filters) {
    const {
      prop,
      shouldCheckArrayFilter,
      shouldCheckRangeFilter,
      noResultsExistenceCheck,

      // generated with the above add test values loop
      shouldHaveResults,

      testExactValues,
      testArrayValues,
      testRangeValues,

      getExactValueCheckFn,
      getArrayValuesCheckFn,
      getRangeValuesCheckFn,
    } = filter

    // EXACT VALUE FILTER
    testExactValues.forEach(exactValue => {
      const exactValueFilter = getExactValueFilter(prop, exactValue)

      testCases.push({
        message: 'Testing exact value filter',
        prop,
        url: getEndpoint(endpointUrl, exactValueFilter),
        checkObj: getExactValueCheckFn(exactValue),
        shouldHaveResults: shouldHaveResults && !noResultsExistenceCheck,
      })
    })

    // ARRAY FILTER
    if (shouldCheckArrayFilter) {
      if (testArrayValues && testArrayValues.length) {
        const arrayFilter = getArrayValuesFilter(prop, testArrayValues)

        testCases.push({
          message: 'Testing array values filter',
          prop,
          url: getEndpoint(endpointUrl, arrayFilter),
          checkObj: getArrayValuesCheckFn(testArrayValues),
          shouldHaveResults: shouldHaveResults && !noResultsExistenceCheck,
        })

        const commaSeparatedValuesFilter = getArrayCommaSeparatedValuesFilter(prop, testArrayValues)

        testCases.push({
          message: 'Testing array comma-separated values filter',
          prop,
          url: getEndpoint(endpointUrl, commaSeparatedValuesFilter),
          checkObj: getArrayValuesCheckFn(testArrayValues),
          shouldHaveResults: shouldHaveResults && !noResultsExistenceCheck,
        })
      }
    // RANGE FILTER
    } else if (shouldCheckRangeFilter) {
      if (testRangeValues) {
        const invalidGreaterThanRangeFilter = getInvalidGreaterThanRangeFilter(prop, testRangeValues)

        testCases.push({
          message: 'Testing invalid greater than range filter',
          prop,
          url: getEndpoint(endpointUrl, invalidGreaterThanRangeFilter),
          statusCode: 400,
        })

        const invalidLesserThanRangeFilter = getInvalidLesserThanRangeFilter(prop, testRangeValues)

        testCases.push({
          message: 'Testing invalid lesser than range filter',
          prop,
          url: getEndpoint(endpointUrl, invalidLesserThanRangeFilter),
          statusCode: 400,
        })

        const uniqueRangeValue = testRangeValues.min === testRangeValues.max

        if (!uniqueRangeValue) {
          const rangeFilter1 = getRangeFilter(prop, testRangeValues, false, false)

          testCases.push({
            message: 'Testing range filter (gt, lt)',
            prop,
            url: getEndpoint(endpointUrl, rangeFilter1),
            checkObj: getRangeValuesCheckFn({ gt: testRangeValues.min, lt: testRangeValues.max }),
            shouldHaveResults: false, // not sure to have results if there are none within the range
          })

          const rangeFilter2 = getRangeFilter(prop, testRangeValues, false, true)

          testCases.push({
            message: 'Testing range filter (gt, lte)',
            prop,
            url: getEndpoint(endpointUrl, rangeFilter2),
            checkObj: getRangeValuesCheckFn({ gt: testRangeValues.min, lte: testRangeValues.max }),
            shouldHaveResults: shouldHaveResults && !noResultsExistenceCheck,
          })

          const rangeFilter3 = getRangeFilter(prop, testRangeValues, true, false)

          testCases.push({
            message: 'Testing range filter (gte, lt)',
            prop,
            url: getEndpoint(endpointUrl, rangeFilter3),
            checkObj: getRangeValuesCheckFn({ gte: testRangeValues.min, lt: testRangeValues.max }),
            shouldHaveResults: shouldHaveResults && !noResultsExistenceCheck,
          })
        }

        const rangeFilter4 = getRangeFilter(prop, testRangeValues, true, true)

        testCases.push({
          message: 'Testing range filter (gte, lte)',
          prop,
          url: getEndpoint(endpointUrl, rangeFilter4),
          checkObj: getRangeValuesCheckFn({ gte: testRangeValues.min, lte: testRangeValues.max }),
          shouldHaveResults: shouldHaveResults && !noResultsExistenceCheck,
        })
      }
    }
  }

  const getErrorMessage = (message, { url, obj, prop }) => {
    return `${message} on ${prop} (${url})\n${JSON.stringify(obj, null, 2)}`
  }

  for (const testCase of testCases) {
    const {
      message,
      url,
      prop,
      checkObj,
      statusCode = 200,
      shouldHaveResults,
    } = testCase

    const { body: paginationObject } = await request(t.context.serverUrl)
      .get(url)
      .set(authorizationHeaders)
      .expect(statusCode)

    if (statusCode === 200) {
      if (_.isFunction(checkPaginationObject)) checkPaginationObject(t, paginationObject)

      const { results } = paginationObject

      results.forEach(obj =>
        t.true(
          checkObj(obj),
          getErrorMessage(message, { url, obj, prop })
        )
      )

      if (shouldHaveResults) {
        t.true(results.length > 0, `Should have results for ${url}`)
      }
    }
  }
}
