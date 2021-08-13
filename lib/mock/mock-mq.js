const Mq = require('mq')
const RoutingKeyParser = require('rabbit-routingkey-parser')
const { createContentFromBody } = require('../utils')
const routingKeyParser = new RoutingKeyParser()

class MockMq extends Mq {
  constructor (...args) {
    super(...args)
    this.handlers = {}
  }

  async configure () {
    this.publishChannel = {
      publish: async (exchange, routingKey, content, options) => {
        process.nextTick(() => {
          this.emit('message', {
            exchange,
            routingKey,
            content,
            options
          })
        })
        return Promise.resolve()
      },

      sendToQueue: async (queue, content, opts) => {
        process.nextTick(() => {
          this.emit('reply', {
            queue,
            content,
            opts
          })
        })
      }
    }
    this.consumeChannel = {
      ack () {},
      nack () {}
    }
  }

  async handle ({ queue, handler }) {
    this.handlers[queue] = {
      handler
    }
  }

  async injectReply ({ body, properties, headers }) {
    if (!this.topology.replyQueue) {
      throw new Error('replyQueue missing for topology')
    }

    const content = createContentFromBody(body, properties.contentType)
    return this._onReply({ content, properties, headers })
  }

  async inject ({ body, properties, headers }) {
    const bindings = this.topology.bindings.filter(binding => {
      if (!binding.exchange === properties.exchange) {
        return false
      }
      if (!this.handlers[binding.target]) {
        return false
      }

      return binding.keys.some(key =>
        routingKeyParser.test(key, properties.routingKey)
      )
    })

    const content = createContentFromBody(body, properties.contentType)
    return Promise.all(
      bindings.map(b =>
        this._onMessage(
          { content, properties, headers },
          this.handlers[b.target]
        )
      )
    )
  }
}

module.exports = MockMq
