import amqp from 'amqp-connection-manager'
import { randomUUID } from 'crypto'
import { EventEmitter, once } from 'events'
import { promisify } from 'util'
import Request from './request.js'
import Message from './message.js'
import {
  MessageHandlerError,
  MqError,
  ReconnectTimeoutError,
  RequestTimeoutError,
  UnblockTimeoutError
} from './errors.js'
import { createContentFromBody } from './utils.js'

const sleep = promisify(setTimeout)
function noop () {}

export default class Mq2 extends EventEmitter {
  constructor ({
    topology, // connection and queue/exchange details
    logger, // custom logger, must implement 'warn'
    unblockTimeout, // time to wait for connection to be unblocked
    reconnectTimeout, // time to wait for successful reconnect
    reconnectTime, // time to wait before trying to reconnect
    unhandledTimeout = 3 * 60e3, // time until ack or handler finished
    requestTimeout = 10e3 // time until reply, must this be <= unhandledTimeout?
  }) {
    super()
    this.logger = logger ?? {
      warn: console.warn
    }
    this.topology = topology
    this.heartbeat = topology.connection.heartbeat ?? 10 // seconds
    this.unhandledTimeout = unhandledTimeout
    this.requestTimeout = requestTimeout
    this.unblockTimeout = unblockTimeout ?? this.heartbeat * 3e3
    this.reconnectTimeout = reconnectTimeout ?? this.heartbeat * 3e3
    this.reconnectTimeInSeconds =
      typeof reconnectTime === 'number'
        ? Math.round(reconnectTime / 1e3)
        : this.heartbeat
    this.requests = []
    this._consumerUnsubscribed = false
  }

  async configure () {
    const topology = this.topology
    const connectionOptions = topology.connection
    const socketOptions = {
      timeout: 10e3,
      ...(topology.socketOptions || {})
    }

    const [publishConnection, consumeConnection] = await Promise.all([
      this._createConnection(connectionOptions, {
        connectionType: 'publisher',
        ...socketOptions
      }),
      this._createConnection(connectionOptions, {
        connectionType: 'consumer',
        ...socketOptions
      })
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
        console.log('mq3 on connect')
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

        if (!reconnectTimer) {
          this.emit('disconnect', err)
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null
            this.emit('error', new ReconnectTimeoutError())
          }, this.reconnectTimeout)
        }
      })
    }
    setupTimeouts(publishConnection, false)
    setupTimeouts(consumeConnection, true)

    const [publishChannel, consumeChannel] = await Promise.all([
      this._createPublishChannel(publishConnection, topology),
      this._createConsumeChannel(consumeConnection, topology)
    ])

    this.publishConnection = publishConnection
    this.publishChannel = publishChannel
    this.consumeConnection = consumeConnection
    this.consumeChannel = consumeChannel
  }

  async shutdown () {
    await this.close()
  }

  async close () {
    await Promise.all([
      this.publishConnection.close(),
      this.consumeConnection.close()
    ])
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

    // Remove all setup functions as we don't want to start consuming again on
    // reconnect
    this.consumeChannel._setups = []

    const channel = this.consumeChannel._channel
    if (channel) {
      await Promise.all(
        Object.keys(channel.consumers).map(consumerTag =>
          channel.cancel(consumerTag)
        )
      )
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

    await this.consumeChannel.addSetup(async channel => {
      channel.prefetch(prefetch, false)
      await channel.consume(
        queue,
        async msg => {
          // When the consumer is cancelled, this callback is called with a 'null'
          // message
          if (!msg) {
            // Force a reconnect by manually closing the current connection
            this.consumeConnection._currentConnection?.close()
            return
          }

          let message
          if (typeof msg.properties.replyTo === 'string') {
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
              sleep(unhandledTimeout).then(() => {
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
          arguments: options.arguments
        }
      )
    })
  }

  async publish (exchange, { body, routingKey, headers }, options) {
    const opts = {
      headers,
      contentEncoding: 'utf8',
      contentType: 'application/json',
      correlationId: randomUUID(),
      ...options
    }

    const content = createContentFromBody(body, opts.contentType)
    return this._publish(exchange, routingKey, content, opts)
  }

  async request (exchange, message, options) {
    const replyQueue = this.topology.replyQueue
    if (!replyQueue) {
      throw new Error('no reply queue in topology')
    }

    const correlationId = randomUUID()

    // Wait this long until reply, or throw
    const timeout = message.timeout ?? this.requestTimeout

    await this.publish(exchange, message, {
      replyTo: replyQueue.name,
      correlationId,
      expiration: timeout,
      ...options
    })

    const reply = new Promise((resolve, reject) => {
      this.requests.push({ correlationId, resolve, reject })
    })

    return Promise.race([
      reply,
      sleep(timeout).then(() => {
        throw new RequestTimeoutError()
      })
    ])
  }

  async _handleMessage (message, { preHandler, handler }) {
    switch (this.properties.contentType) {
      case 'application/json':
        this.body = JSON.parse(this.content)
        break
      case 'text/plain':
        this.body = this.content.toString()
        break
      default:
        this.body = this.content
    }

    if (typeof preHandler === 'function') {
      await preHandler(message)
    }

    await handler(message)

    if (message instanceof Request && !message.replied) {
      throw new MessageHandlerError('Not replied')
    } else if (!message.noAck && !message.acked) {
      throw new MessageHandlerError('Not acked')
    }
  }

  async _publish (exchange, routingKey, content, options) {
    // The message is queued if we are disconnected. In order to not wait
    // indefinitely for a message to resolve, we have a timeout on the
    // reconnect
    await this.publishChannel.publish(exchange, routingKey, content, options)
  }

  async _onReply (message) {
    if (!message) {
      // Force a reconnect by manually closing the current connection
      this.consumeConnection._currentConnection?.close()
      return
    }

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
      this.logger.warn('received unknown reply', JSON.stringify(message))
      return
    }

    message.ack = noop
    message.nack = noop
    message.reject = noop
    const [request] = this.requests.splice(idx, 1)
    request.resolve(message)
  }

  async _createConnection (urlObj, socketOptions) {
    const connection = amqp.connect(
      {
        protocol: urlObj.protocol ?? 'amqp',
        hostname: urlObj.host,
        port: urlObj.port ?? 5672,
        username: urlObj.user,
        password: urlObj.pass,
        heartbeat: this.heartbeat,
        vhost: urlObj.vhost ?? '/'
      },
      {
        connectionOptions: socketOptions,
        heartbeatIntervalInSeconds: this.heartbeat,
        reconnectTimeInSeconds: this.reconnectTimeInSeconds
      }
    )
    await Promise.race([
      once(connection, 'connect'),
      once(connection, 'disconnect').then(err => {
        throw err
      })
    ])
    return connection
  }

  async _createPublishChannel (connection, topology) {
    const channel = connection.createChannel({
      setup: channel => {
        if (topology.exchanges) {
          return assertExchanges(channel, topology.exchanges)
        }
      }
    })
    await once(channel, 'connect')
    return channel
  }

  async _createConsumeChannel (connection, topology) {
    const channel = connection.createChannel({
      setup: async channel => {
        await this._setupTopology(channel, topology)

        if (topology.replyQueue) {
          channel.prefetch(0, false)
          await channel.consume(
            topology.replyQueue.name,
            this._onReply.bind(this),
            {
              noAck: true,
              exclusive: false,
              arguments: null
            }
          )
        }
      }
    })
    await once(channel, 'connect')
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
      if (!Array.isArray(binding.keys) || binding.keys.length === 0) {
        throw new Error(`binding is missing array of keys`)
      }

      if (!queues.some(q => q.name === binding.target)) {
        throw new Error(`queue ${binding.target} not specified in topology`)
      }

      if (!exchanges.some(e => e.name === binding.exchange)) {
        throw new Error(
          `exchange ${binding.exchange} not specified in topology`
        )
      }

      return Promise.all(
        binding.keys.map(key =>
          channel.bindQueue(binding.target, binding.exchange, key, binding.args)
        )
      )
    })
  )
}
