const { EventEmitter } = require('events')

class FakeChannelWrapper extends EventEmitter {}

class FakeConnectionWrapper extends EventEmitter {
  createChannel (...opts) {
    return new FakeChannelWrapper(...opts)
  }
}

module.exports = {
  fakeAmqpConnectionManager: {
    connect (...opts) {
      const connection = new FakeConnectionWrapper(...opts)
      setImmediate(() => {
        connection.emit('connect')
      })

      return connection
    }
  }
}
