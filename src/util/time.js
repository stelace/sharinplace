const moment = require('moment-timezone')
const ms = require('ms')
const CronConverter = require('cron-converter')

const allowedTimeUnits = [
  'm', // minute
  'h', // hour
  'd', // day
  'n', // night
  'w', // week
  'M' // month
]

// (key: value): stelace unit => moment unit
const mapMomentTimeUnits = {
  n: 'd'
}

/**
* Check if the provided date is an instance of Date and a valid date
* @param  {Date}  date
* @return {Boolean}
*/
function isDate (date) {
  return date && typeof date === 'object' && date.getTime && !isNaN(date.getTime())
}

/**
* Check if the provided value is UTC-format date string
* @param  {String}  value
* @param  {Object}  [options]
* @param  {Boolean} [options.onlyDate = false]
* @return {Boolean}
*/
function isDateString (value, { onlyDate = false } = {}) {
  if (typeof value !== 'string') return false

  let regex

  if (onlyDate) {
    regex = /^\d{4}-\d{2}-\d{2}$/
  } else {
    regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/
  }

  if (!regex.test(value)) return false

  const date = new Date(value)
  return isDate(date)
}

/**
* Check if the date has 0 unit below days (0 hour, 0 minute, 0 second, 0 millisecond)
* If true, that means the date is probably an automated date (not created by user)
* @param  {String|Object}  date
* @return {Boolean}
*/
function isPureDate (date) {
  if (!isDateString(date) && !isDate(date)) {
    throw new Error('Expected a valid date')
  }

  return date.slice(11) === '00:00:00.000Z'
}

function getPureDate (date) {
  if (!isDateString(date) && !isDate(date)) {
    throw new Error('Expected a valid date')
  }

  const m = moment(date)
  return m.format('YYYY-MM-DD') + 'T00:00:00.000Z'
}

function isIntersection (array, value) {
  return array.reduce((memo, element) => {
    if (value.endDate <= element.startDate || element.endDate <= value.startDate) {
      return memo
    } else {
      return memo || true
    }
  }, false)
}

/**
 * Utility function that converts multiple formats to milliseconds
 * - object duration (like Moment.js): { d: 10, h: 5 }
 * - string duration (like zeit/ms): "10m"
 * @param {Object|String} duration
 * @return {Number} milliseconds
 */
function convertToMs (duration) {
  if (typeof duration === 'undefined' || duration === null) {
    return duration
  }

  if (typeof duration === 'string') {
    if (!duration) {
      return
    }

    const milliseconds = ms(duration)
    if (typeof milliseconds === 'undefined') {
      throw new Error('Invalid string duration')
    }

    return milliseconds
  } else if (typeof duration === 'object') {
    if (!Object.keys(duration).length) {
      throw new Error('No unit detected')
    }

    return moment.duration(duration).asMilliseconds()
  } else {
    throw new Error('Object or string duration expected')
  }
}

/**
 * Get the new date based on a date and a duration (string or object format)
 * @param {Date|String} isoDate
 * @param {Object|String} duration
 */
function computeDate (isoDate, duration) {
  if (duration && typeof duration === 'object') {
    // use moment here to handle long durations (like 1 year, should be the same day number with year Y+1)
    const momentDuration = Object.keys(duration).reduce((memo, timeUnit) => {
      memo[getMomentTimeUnit(timeUnit)] = duration[timeUnit]
      return memo
    }, {})

    return moment(isoDate).add(momentDuration).toISOString()
  } else {
    return new Date(new Date(isoDate).getTime() + convertToMs(duration)).toISOString()
  }
}

/**
 * Round the date, by default to the nearest minute
 * @param {String|Object} date
 * @param {Number} [nbMinutes = 1]
 */
function getRoundedDate (date, nbMinutes = 1) {
  const d = isDate(date) ? date : new Date(date)

  const ms = nbMinutes * 60 * 1000
  const roundedDate = new Date(Math.round(d.getTime() / ms) * ms)
  return roundedDate.toISOString()
}

function isValidTimezone (timezone) {
  if (typeof timezone !== 'string') return false

  return !!moment.tz.zone(timezone)
}

function isValidCronPattern (pattern) {
  const cronInstance = new CronConverter()
  try {
    cronInstance.fromString(pattern)
    return true
  } catch (e) {
    return false
  }
}

/**
 * @param {String} pattern
 * @param {Object} attrs
 * @param {String} attrs.startDate - inclusive
 * @param {String} attrs.endDate - exclusive
 * @param {String} [attrs.timezone] - defaults to Greenwich time
 * @param {String[]} dates
 */
function computeRecurringDates (pattern, { startDate, endDate, timezone = 'Europe/London' } = {}) {
  if (!isDateString(startDate) || !isDateString(endDate)) {
    throw new Error('Expected start and end dates')
  }
  if (endDate < startDate) {
    throw new Error('Invalid dates')
  }

  const cronInstance = new CronConverter({
    timezone
  })
  cronInstance.fromString(pattern)

  const schedule = cronInstance.schedule(startDate)

  let continueLoop = true
  const dates = []

  while (continueLoop) {
    const momentDate = schedule.next()

    const date = momentDate.toISOString()

    continueLoop = date < endDate

    if (continueLoop) {
      dates.push(date)
    }
  }

  return dates
}

/**
* @param {String} pattern
* @param {Object} options
* @param {String} options.startDate
* @param {String} options.endDate
* @param {String|Object} options.duration
* @param {String} [options.timezone]
* @return {Object[]} dates
* @return {String}   dates[i].startDate
* @return {String}   dates[i].endDate
*/
function computeRecurringPeriods (pattern, { startDate, endDate, timezone, duration }) {
  const startDates = computeRecurringDates(pattern, { startDate, endDate, timezone })

  return startDates.map(startDate => {
    return {
      startDate,
      endDate: computeDate(startDate, duration)
    }
  })
}

function getMomentTimeUnit (timeUnit) {
  return mapMomentTimeUnits[timeUnit] || timeUnit
}

/**
 * @param {String} endDate
 * @param {String} startDate
 * @param {String} timeUnit
 * @return {Number}
 */
function diffDates (endDate, startDate, timeUnit) {
  return moment.duration(
    moment(endDate).diff(moment(startDate))
  ).as(getMomentTimeUnit(timeUnit))
}

/**
 * @param {Object} duration
 * @param {String} timeUnit
 * @return {Number}
 */
function getDurationAs (duration, timeUnit) {
  return moment.duration(duration).as(getMomentTimeUnit(timeUnit))
}

module.exports = {
  allowedTimeUnits,

  isDate,
  isDateString,
  isPureDate,
  getPureDate,
  isIntersection,
  convertToMs,
  computeDate,
  getRoundedDate,
  isValidTimezone,
  isValidCronPattern,
  computeRecurringDates,
  computeRecurringPeriods,

  diffDates,
  getDurationAs
}