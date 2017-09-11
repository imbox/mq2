const assert = require('assert')
const BufferedQueue = require('buffered-queue')
const RoutingKeyParser = require('rabbit-routingkey-parser')
const util = require('util')
const parser = new RoutingKeyParser()
const Kanin = require('kanin')

module.exports = Mq2

const noop = () => {}

function Mq2 (opts) {
  if (!new.target) {
    return new Mq2(opts)
  }

  assert(opts, 'options object missing')
  assert(opts.topology, 'topology missing')

  this.unhandledTimeout = opts.unhandledTimeout || 120 * 1000
  this.statisticsEnabled = opts.statisticsEnabled || false
  this.serviceName = opts.serviceName || 'default'
  this.topology = opts.topology

  this.kanin = new Kanin({topology: opts.topology})

  const logger = (this.logger = opts.logger || {
    debug: console.log,
    warn: console.error
  })

  this.kanin.on('error', err => {
    throw err
  })

  this.kanin.on('connection.opened', () => {
    logger.debug('Rabbitmq connection opened')
  })

  this.kanin.on('connection.closed', () => {
    logger.debug('Rabbitmq connection closed (intentional)')
  })

  this.kanin.on('connection.failed', err => {
    logger.warn(`Rabbitmq connection failed (unintentional) ${err.stack}`)
  })

  this.kanin.on('channel.error', err => {
    throw err
  })

  this.kanin.on(
    'connection.unreachable',
    opts.onConnectionUnreachable ||
      function () {
        throw new Error('Rabbitmq connection unreachable')
      }
  )

  if (this.statisticsEnabled) {
    const serviceName = this.serviceName
    const publish = this.publish.bind(this)
    this.statsQueue = new BufferedQueue('stats-queue', {
      size: 1000,
      flushTimeout: 5000,
      verbose: false,
      customResultFunction (items) {
        publish('stats-exchange', {
          routingKey: 'stats.v1.messagesProcessTime',
          body: {
            type: 'messagesProcessTime',
            service: serviceName,
            data: items,
            timestamp: new Date().toISOString()
          }
        })
      }
    })
  }
}

Mq2.prototype.configure = function (cb) {
  assert(cb, 'callback missing')
  this.kanin.configure(cb)
}

Mq2.prototype.handle = function (opts, cb) {
  const queue = opts.queue
  const handler = opts.handler
  const options = {
    prefetch: setDefault(opts.prefetch, 0),
    noAck: setDefault(opts.noAck, false),
    exclusive: setDefault(opts.exclusive, false),
    arguments: setDefault(opts.arguments, null)
  }

  const onUncaughtException = opts.onUncaughtException
  const types = opts.types

  const logger = this.logger
  const serviceName = this.serviceName
  const unhandledTimeout = this.unhandledTimeout
  const statisticsEnabled = this.statisticsEnabled
  const statsQueue = this.statsQueue

  const onMessage = message => {
    const startDateTimeMs = new Date().getTime()
    const startTime = now()

    if (
      serviceName !== 'default' &&
      message.body._meta &&
      message.body._meta.services
    ) {
      message.body._meta.services.push([serviceName, startDateTimeMs])
    }

    if (options.noAck !== true) {
      message.timeoutHandler = setTimeout(() => {
        logger.warn(`TimeoutError: ${util.inspect(message)}`)
        message.reject()
        message.ack = () => {}
        message.nack = () => {}
        message.reply = () => {}
        message.reject = () => {}
      }, unhandledTimeout)

      const ack = message.ack
      message.ack = () => {
        if (statisticsEnabled) {
          statsQueue.add({
            routingKey: message.fields.routingKey,
            queue: queue,
            startTime: startDateTimeMs,
            json: JSON.stringify(message.body),
            duration: now() - startTime
          })
        }
        clearTimeout(message.timeoutHandler)
        ack(message)
      }

      const nack = message.nack
      message.nack = () => {
        clearTimeout(message.timeoutHandler)
        nack(message)
      }

      const reject = message.reject
      message.reject = () => {
        clearTimeout(message.timeoutHandler)
        reject(message)
      }
    }

    message.fields.parts = parseRoutingKeys(types, message.fields.routingKey)

    // Remove the raw buffer content
    delete message.content

    if (!onUncaughtException) {
      return handler(message)
    }

    try {
      handler(message)
    } catch (err) {
      onUncaughtException(err, message)
    }
  }

  this.kanin.handle({queue, options, onMessage}, cb)
}

Mq2.prototype.close = function (cb) {
  this.kanin.close(cb || noop)
}

Mq2.prototype.unsubscribeAll = function (cb) {
  this.kanin.unsubscribeAll(cb || noop)
}

Mq2.prototype.shutdown = function (cb) {
  this.kanin.close(cb || noop)
}

Mq2.prototype.publish = function (exchangeName, message) {
  this.kanin.publish(exchangeName, message)
}

Mq2.prototype.request = function (exchangeName, message, cb) {
  this.kanin.request(exchangeName, message, cb)
}

function parseRoutingKeys (types, routingKey) {
  if (!types || types.length === 0) {
    return null
  }

  let foundParts
  for (let i = 0; i < types.length; i++) {
    let parts
    try {
      parts = parser.parse(types[i], routingKey)
    } catch (err) {
      continue
    }

    if (parts.length > 1) {
      foundParts = parts
      break
    }
  }

  return foundParts || [routingKey]
}

function setDefault (x, val) {
  return x === undefined ? val : null
}

const getNanoSeconds = () => {
  const hr = process.hrtime()
  return hr[0] * 1e9 + hr[1]
}
const loadTime = getNanoSeconds()
const now = () => (getNanoSeconds() - loadTime) / 1e6

const exists = x => x != null
