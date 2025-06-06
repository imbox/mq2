'use strict'

const AmqpConnectionManager = require('amqp-connection-manager')
  .AmqpConnectionManagerClass
const { randomUUID } = require('crypto')
const { EventEmitter, once } = require('events')
const { promisify } = require('util')
const {
  MessageHandlerError,
  MqError,
  ReconnectTimeoutError,
  RequestTimeoutError,
  UnblockTimeoutError
} = require('./errors')
const Request = require('./request')
const Message = require('./message')
const { createContentFromBody } = require('./utils')

const sleep = promisify(setTimeout)
function sleepUnref (value) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve()
    }, value).unref()
  })
}

function noop () {}

class Mq2 extends EventEmitter {
  constructor ({
    topology, // connection and queue/exchange details
    logger, // optional custom logger, must implement 'warn'
    findServers, // optional function to find servers
    confirm, // create confirm channel (default false)
    socketTimeout, // time to wait for underlying connection connect
    unblockTimeout, // time to wait for connection to be unblocked
    reconnectTimeout, // time to wait for successful reconnect
    reconnectTime, // time to wait before trying to reconnect
    unhandledTimeout = 3 * 60e3, // time until ack or handler finished
    requestTimeout = 10e3, // time until reply, must this be <= unhandledTimeout?
    publishTimeout = 5e3 // time to wait for message to be published, should be <= requestTimeout
  }) {
    super()
    this.logger = logger ?? {
      warn: console.warn,
      error: console.error
    }
    this.topology = topology
    this.findServers = findServers
    this.heartbeat = topology.connection.heartbeat ?? 10 // seconds
    this.socketTimeout =
      socketTimeout ?? this.topology.socketOptions?.timeout ?? 5e3
    this.unhandledTimeout = unhandledTimeout
    this.requestTimeout = requestTimeout
    this.publishTimeout = publishTimeout
    this.unblockTimeout = unblockTimeout ?? this.heartbeat * 3e3
    this.reconnectTimeout = reconnectTimeout ?? this.heartbeat * 3e3
    this.reconnectTimeInSeconds =
      typeof reconnectTime === 'number'
        ? Math.round(reconnectTime / 1e3)
        : this.heartbeat
    this.requests = []
    this._consumerUnsubscribed = false
    this._confirm = typeof confirm === 'boolean' ? confirm : false
  }

  async configure () {
    const topology = this.topology
    const connOpts = topology.connection

    let urlObj
    if (this.findServers == null) {
      urlObj = {
        protocol: connOpts.protocol ?? 'amqp',
        hostname: connOpts.hostname ?? connOpts.host,
        port: connOpts.port ?? 5672,
        username: connOpts.username ?? connOpts.user,
        password: connOpts.password ?? connOpts.pass,
        heartbeat: this.heartbeat,
        vhost: connOpts.vhost ?? '/'
      }
    }

    const socketOptions = topology.socketOptions ?? {}

    const createConnection = connectionType => {
      return new AmqpConnectionManager(urlObj, {
        connectionOptions: {
          timeout: this.socketTimeout,
          ...socketOptions,
          clientProperties: {
            ...socketOptions.clientProperties,
            connectionType
          }
        },
        findServers: this.findServers,
        heartbeatIntervalInSeconds: this.heartbeat,
        reconnectTimeInSeconds: this.reconnectTimeInSeconds
      })
    }

    this.publishConnection = createConnection('publisher')
    this.consumeConnection = createConnection('consumer')

    await Promise.all([
      this.publishConnection.connect({ timeout: this.reconnectTimeout }),
      this.consumeConnection.connect({ timeout: this.reconnectTimeout })
    ])

    const setupTimeouts = (conn, isConsumer) => {
      let blockTimer = null
      conn.on('unblocked', () => {
        this.emit('unblocked')
        if (blockTimer) {
          clearTimeout(blockTimer)
          blockTimer = null
        }
      })
      conn.on('blocked', ({ reason }) => {
        if (!blockTimer) {
          this.emit('blocked', { reason })
          blockTimer = setTimeout(() => {
            blockTimer = null
            this.emit('error', new UnblockTimeoutError())
          }, this.unblockTimeout)
        }
      })

      let reconnectTimer = null
      conn.on('connect', () => {
        this.emit('connect')
        if (reconnectTimer) {
          clearTimeout(reconnectTimer)
          reconnectTimer = null
        }
      })

      conn.on('disconnect', ({ err }) => {
        if (isConsumer && this._consumerUnsubscribed) {
          this.logger.warn('disconnect after unsubscribe')
          return
        }

        if (err.code >= 400) {
          this.logger.error(err)
        }

        if (!reconnectTimer) {
          this.emit('disconnect', err)
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null
            this.emit('error', new ReconnectTimeoutError())
          }, this.reconnectTimeout)
        }
      })
    }
    setupTimeouts(this.publishConnection, false)
    setupTimeouts(this.consumeConnection, true)

    await Promise.all([
      this._createPublishChannel(this.publishConnection).then(channel => {
        this.publishChannel = channel
        return null
      }),
      this._createConsumeChannel(this.consumeConnection).then(channel => {
        this.consumeChannel = channel
        return null
      })
    ])
  }

  async shutdown () {
    await this.close()
  }

  async close () {
    // Wait for one second for unconfirmed messages to be handled
    for (let i = 0; i < 10; i++) {
      if (this.publishChannel?._unconfirmedMessages.length > 0) {
        await sleep(10)
      } else {
        break
      }
    }

    await Promise.all([
      this.publishConnection?.close(),
      this.consumeConnection?.close()
    ])
    this.publishConnection?.removeAllListeners()
    this.consumeConnection?.removeAllListeners()
    this.requests.forEach(x => x.reject(new MqError('Closed')))
    this.requests = []
  }

  async unsubscribeAll () {
    // There is a bug with the unsubscribe together with quorum queues which
    // might cause a disconnect.
    // https://github.com/squaremo/amqp.node/issues/641
    //
    // Until that bug has been fixed, we ignore the consumer disconnect if it
    // happens
    this._consumerUnsubscribed = true
    if (this.consumeChannel) {
      await this.consumeChannel.cancelAll()
    }

    this.requests.forEach(x => x.reject(new MqError('Unsubscribed')))
    this.requests = []
  }

  async handle (options) {
    const { queue, types, preHandler, handler } = options
    const unhandledTimeout = options.unhandledTimeout ?? this.unhandledTimeout
    const onUncaughtException = options.onUncaughtException ?? noop
    const prefetch = options.prefetch ?? 10
    const noAck = options.noAck ?? false
    const exclusive = options.exlusive ?? false

    await this.consumeChannel.consume(
      queue,
      async msg => {
        let message
        if (msg.properties.replyTo) {
          message = new Request(msg, {
            consumeChannel: this.consumeChannel,
            publishChannel: this.publishChannel,
            noAck
          })
        } else {
          message = new Message(msg, {
            consumeChannel: this.consumeChannel,
            publishChannel: this.publishChannel,
            noAck,
            types
          })
        }

        // The errors here must be catched
        try {
          await Promise.race([
            this._handleMessage(message, {
              preHandler,
              handler
            }),
            sleepUnref(unhandledTimeout, { ref: false }).then(() => {
              throw new MessageHandlerError('Timeout')
            })
          ])
        } catch (err) {
          try {
            await onUncaughtException(err, message)
          } catch (err) {
            this.logger.warn(err)
          }
        }
      },
      {
        noAck,
        exclusive,
        arguments: options.arguments,
        prefetch
      }
    )
  }

  async publish (exchange, { body, routingKey, headers }, options) {
    // randomUUID is relatively costly to compute, so check if we have it before
    // doing it
    let correlationId
    if (options && options.correlationId) {
      correlationId = options.correlationId
    } else {
      correlationId = randomUUID()
    }

    const opts = {
      headers,
      contentEncoding: 'utf8',
      contentType: 'application/json',
      correlationId,
      timeout: this.publishTimeout,
      ...options
    }

    const content = createContentFromBody(body, opts.contentType)
    return this.publishChannel.publish(exchange, routingKey, content, opts)
  }

  async request (exchange, message, options) {
    const replyQueue = this.topology.replyQueue
    if (!replyQueue) {
      throw new Error('no reply queue in topology')
    }

    const correlationId = randomUUID()

    // Wait this long for a reply, or throw
    const requestTimeout = message.timeout ?? this.requestTimeout

    await this.publish(exchange, message, {
      replyTo: replyQueue.name,
      correlationId,
      // Expiration starts first when the message is placed in a RabbitMq queue
      // which might be long after the message is expired. Even though that is
      // the case, it is at least better than not having any expire at all.
      expiration: requestTimeout,
      ...options
    })

    const reply = new Promise((resolve, reject) => {
      this.requests.push({ correlationId, resolve, reject })
    })

    return Promise.race([
      reply,
      sleepUnref(requestTimeout).then(() => {
        const idx = this.requests.findIndex(
          r => r.correlationId === correlationId
        )
        if (idx !== -1) {
          this.requests.splice(idx, 1)
        }
        throw new RequestTimeoutError()
      })
    ])
  }

  async _handleMessage (message, { preHandler, handler }) {
    if (typeof preHandler === 'function') {
      await preHandler(message)
    }

    await handler(message)

    if (message instanceof Request && !message.replied) {
      throw new MessageHandlerError('Not replied')
    } else if (!message.acked && !message.noAck) {
      throw new MessageHandlerError('Not acked')
    }
  }

  async _onReply (message) {
    if (message.properties.contentType === 'application/json') {
      message.body = JSON.parse(message.content)
    } else if (message.properties.contentType === 'text/plain') {
      message.body = message.content.toString()
    } else {
      message.body = message.content
    }
    delete message.content

    const idx = this.requests.findIndex(
      x => x.correlationId === message.properties.correlationId
    )
    if (idx === -1) {
      // Request might have been timed out
      return
    }

    message.ack = noop
    message.nack = noop
    message.reject = noop
    const [request] = this.requests.splice(idx, 1)
    request.resolve(message)
  }

  async _createPublishChannel (connection) {
    const topology = this.topology
    const channel = connection.createChannel({
      confirm: this._confirm,
      setup: channel => {
        if (topology.exchanges) {
          return assertExchanges(channel, topology.exchanges)
        }
      }
    })
    await once(channel, 'connect')
    return channel
  }

  async _createConsumeChannel (connection) {
    const topology = this.topology
    const channel = connection.createChannel({
      confirm: false, // consume channels never publish so confirm is unnecessary
      setup: async channel => {
        await this._setupTopology(channel, topology)
      }
    })

    await Promise.all([
      once(channel, 'connect'),
      (() => {
        if (topology.replyQueue) {
          return channel.consume(
            topology.replyQueue.name,
            this._onReply.bind(this),
            {
              noAck: true,
              exclusive: false,
              prefetch: 0
            }
          )
        }
      })()
    ])
    return channel
  }

  async _setupTopology (channel, topology) {
    const exchanges = topology.exchanges || []
    const queues = topology.queues || []
    const bindings = topology.bindings || []
    const replyQueue = topology.replyQueue

    await Promise.all([
      assertExchanges(channel, exchanges),
      assertQueues(channel, queues)
    ])

    if (bindings.length > 0) {
      await setupBindings(channel, exchanges, queues, bindings)
    }

    if (replyQueue) {
      await channel.assertQueue(replyQueue.name, {
        exclusive: replyQueue.exclusive ?? false,
        durable: replyQueue.durable ?? false,
        autoDelete: replyQueue.autoDelete ?? false,
        expires: replyQueue.expires ?? this.reconnectTimeout,
        arguments: replyQueue.arguments
      })
    }
  }
}

async function assertExchanges (channel, exchanges) {
  return Promise.all(
    exchanges.map(e => {
      return channel.assertExchange(e.name, e.type, {
        durable: e.durable ?? true,
        autoDelete: e.autoDelete ?? false,
        arguments: e.arguments
      })
    })
  )
}

async function assertQueues (channel, queues) {
  return Promise.all(
    queues.map(q => {
      return channel.assertQueue(q.name, {
        exclusive: q.exclusive ?? false,
        durable: q.durable ?? true,
        autoDelete: q.autoDelete ?? false,
        expires: q.expires,
        arguments: q.arguments
      })
    })
  )
}

async function setupBindings (channel, exchanges, queues, bindings) {
  return Promise.all(
    bindings.map(binding => {
      if (!queues.some(q => q.name === binding.target)) {
        throw new Error(`queue ${binding.target} not specified in topology`)
      }

      const exchange = exchanges.find(e => e.name === binding.exchange)
      if (!exchange) {
        throw new Error(
          `exchange ${binding.exchange} not specified in topology`
        )
      }

      const keys = binding.keys
      if (Array.isArray(keys)) {
        if (keys.length === 0) {
          throw new Error(`binding has empty array of keys`)
        }
        return Promise.all(
          binding.keys.map(key =>
            channel.bindQueue(
              binding.target,
              binding.exchange,
              key,
              binding.args
            )
          )
        )
      } else if (exchange.type === 'topic') {
        // Exchanges of type topic are always expected to have keys in bindings
        throw new Error(`binding is missing array of keys`)
      }

      return channel.bindQueue(
        binding.target,
        binding.exchange,
        '',
        binding.args
      )
    })
  )
}

module.exports = Mq2
