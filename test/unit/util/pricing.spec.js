require('dotenv').config()

const test = require('ava')

const {
  roundPrice,
  isValidCustomDurationConfig,
  getDurationPrice
} = require('../../../src/util/pricing')

test('rounds price to cents', (t) => {
  const tests = [
    {
      nb: 2.46,
      expected: 2.5
    },
    {
      nb: 15.6547,
      expected: 15
    },
    {
      nb: 789.78956,
      expected: 789
    }
  ]

  tests.forEach(({ nb, expected }) => {
    t.is(roundPrice(nb), expected)
  })
})

test('check if the custom pricing config is valid', (t) => {
  const config1 = {
    duration: {
      breakpoints: [
        { nbUnits: 1, price: 10 },
        { nbUnits: 10, price: 100 }
      ]
    }
  }
  const config2 = {
    duration: {
      breakpoints: [
        { nbUnits: 2, price: 20 },
        { nbUnits: 10, price: 100 }
      ]
    }
  }

  t.true(isValidCustomDurationConfig(config1.duration))
  t.false(isValidCustomDurationConfig(config2.duration))
})

test('gets the price with custom duration config', (t) => {
  const config = {
    duration: {
      breakpoints: [
        { nbUnits: 1, price: 50 },
        { nbUnits: 2, price: 40 }
      ]
    }
  }

  const tests = [
    {
      input: {
        timeUnitPrice: 50,
        nbTimeUnits: 3,
        customConfig: config,
        array: true
      },
      expected: [50, 90, 130]
    },
    {
      input: {
        timeUnitPrice: 10,
        nbTimeUnits: 3,
        customConfig: config,
        array: false
      },
      expected: 130
    }
  ]

  tests.forEach(({ input, expected }) => {
    t.deepEqual(getDurationPrice(input), expected)
  })
})
