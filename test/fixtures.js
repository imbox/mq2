'use strict'

const { EventEmitter } = require('events')

class FakeChannelWrapper extends EventEmitter {
  constructor () {
    super()
    this.published = []
  }

  async publish (exchange, routingKey, content, options) {
    this.published.push({ exchange, routingKey, content, options })
    return false
  }
}

class FakeConnectionWrapper extends EventEmitter {
  constructor () {
    super()
    this.channel = null
  }

  connect () {
    return Promise.resolve()
  }

  createChannel (...args) {
    this.channel = new FakeChannelWrapper(...args)
    setImmediate(() => {
      this.channel.emit('connect')
    })
    return this.channel
  }
}

module.exports = {
  FakeConnectionWrapper,
  FakeChannelWrapper
}
