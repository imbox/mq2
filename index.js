const assert = require('assert')
const BufferedQueue = require('buffered-queue')
const RoutingKeyParser = require('rabbit-routingkey-parser')
const { inspect, promisify } = require('util')
const parser = new RoutingKeyParser()
const Kanin = require('kanin')

module.exports = Mq2

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
  this.requestTimeout = opts.requestTimeout || 10000
  this.publishTimeout = opts.publishTimeout || 5000

  this.kanin = new Kanin({
    topology: opts.topology,
    requestTimeout: this.requestTimeout,
    publishTimeout: this.publishTimeout
  })
  this.writeKanin = new Kanin({
    topology: {
      connection: opts.topology.connection,
      socketOptions: opts.socketOptions,
      exchanges: opts.topology.exchanges
    },
    requestTimeout: this.requestTimeout,
    publishTimeout: this.publishTimeout
  })

  const logger = (this.logger = opts.logger || {
    debug: console.log,
    warn: console.error,
    trace () {}
  })

  this.kanin.on('error', err => {
    throw err
  })

  this.kanin.on('channel.error', err => {
    logger.warn(`Rabbitmq channel error ${err.stack}`)
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

  this.kanin.on(
    'connection.unreachable',
    opts.onConnectionUnreachable ||
      function () {
        throw new Error('Rabbitmq connection unreachable')
      }
  )

  this.writeKanin.on('error', err => {
    throw err
  })

  this.writeKanin.on('channel.error', err => {
    logger.warn(`Rabbitmq write channel error ${err.stack}`)
  })

  this.writeKanin.on('connection.opened', () => {
    logger.debug('Rabbitmq write connection opened')
  })

  this.writeKanin.on('connection.closed', () => {
    logger.debug('Rabbitmq write connection closed (intentional)')
  })

  this.writeKanin.on('connection.failed', err => {
    logger.warn(`Rabbitmq write connection failed (unintentional) ${err.stack}`)
  })

  this.writeKanin.on(
    'connection.unreachable',
    opts.onConnectionUnreachable ||
      function () {
        throw new Error('Rabbitmq write connection unreachable')
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
          .then(() => {})
          .catch(err => {
            logger.warn(`Publish to stats-queue: ${err.stack}`)
          })
      }
    })
  }
}

Mq2.prototype.configure = async function () {
  const configure = promisify((k, cb) => k.configure(cb))
  await Promise.all([
    configure(this.kanin),
    configure(this.writeKanin)
  ])
}

Mq2.prototype.handle = promisify(function (opts, cb) {
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

  const kanin = this.kanin
  const logger = this.logger
  const serviceName = this.serviceName
  const unhandledTimeout = opts.unhandledTimeout || this.unhandledTimeout
  const statisticsEnabled = this.statisticsEnabled
  const statsQueue = this.statsQueue

  const onMessage = message => {
    const startDateTimeMs = new Date().getTime()
    const startTime = now()
    let queueMs
    if (Number.isInteger(message.properties.headers.timestamp_in_ms)) {
      queueMs = Math.max(
        startDateTimeMs - message.properties.headers.timestamp_in_ms,
        0
      )
    }

    if (
      serviceName !== 'default' &&
      message.body._meta &&
      message.body._meta.services
    ) {
      message.body._meta.services.push([serviceName, startDateTimeMs])
    }

    if (options.noAck === true) {
      message.reply = promisify(message.reply)
    } else {
      message.timeoutHandler = setTimeout(() => {
        message.reject()
        message.ack = () => {}
        message.nack = () => {}
        message.reply = () => {}
        message.reject = () => {}
        onUncaughtException(new Error('ETIMEOUT'), message)
      }, unhandledTimeout)

      const ack = message.ack
      message.ack = () => {
        logger.trace(`Ack delivery tag ${message.fields.deliveryTag}`)
        if (statisticsEnabled) {
          statsQueue.add({
            routingKey: message.fields.routingKey,
            queue,
            startTime: startDateTimeMs,
            json: JSON.stringify(message.body),
            duration: now() - startTime,
            queueMs
          })
        }
        clearTimeout(message.timeoutHandler)
        ack(message)
      }

      const nack = message.nack
      message.nack = () => {
        logger.trace(`Nack delivery tag ${message.fields.deliveryTag}`)
        clearTimeout(message.timeoutHandler)
        nack(message)
      }

      const reject = message.reject
      message.reject = () => {
        logger.trace(`Reject delivery tag ${message.fields.deliveryTag}`)
        clearTimeout(message.timeoutHandler)
        reject(message)
      }

      const reply = message.reply
      message.reply = promisify((body, cb) => {
        logger.trace(`Reply delivery tag ${message.fields.deliveryTag}`)
        message.ack()
        reply(body, cb)
      })
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

  logger.trace(`Handle queue ${queue} with options: ${inspect(options)}`)
  kanin.handle({ queue, options, onMessage }, cb)
})

Mq2.prototype.close = async function () {
  const close = promisify((k, cb) => k.close(cb))
  await Promise.all([
    close(this.kanin),
    close(this.writeKanin)
  ])
}

Mq2.prototype.unsubscribeAll = promisify(function (cb) {
  this.kanin.unsubscribeAll(cb)
})

Mq2.prototype.shutdown = async function () {
  const close = promisify((k, cb) => k.close(cb))
  await Promise.all([
    close(this.kanin),
    close(this.writeKanin)
  ])
}

Mq2.prototype.publish = promisify(function (exchangeName, message, cb) {
  this.writeKanin.publish(exchangeName, message, cb)
})

Mq2.prototype.request = promisify(async function (exchangeName, message, cb) {
  this.kanin.request(exchangeName, message, cb)
})

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
  return x !== undefined ? x : val
}

const getNanoSeconds = () => {
  const hr = process.hrtime()
  return hr[0] * 1e9 + hr[1]
}
const loadTime = getNanoSeconds()
const now = () => (getNanoSeconds() - loadTime) / 1e6
