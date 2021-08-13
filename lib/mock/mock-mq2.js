import Mq2 from './mq'
import RoutingKeyParser from 'rabbit-routingkey-parser'
import { createContentFromBody } from '../utils'
const routingKeyParser = new RoutingKeyParser()

class MockChannel {}

export default class MockMq2 extends Mq2 {
  constructor (...args) {
    super(...args)
    this.handlers = {}
  }

  async configure () {
    this.consumeChannel = new MockChannel()
    this.publishChannel = new MockChannel()
  }

  async publish () {}

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
