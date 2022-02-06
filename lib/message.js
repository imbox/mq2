'use strict'

const RoutingKeyParser = require('rabbit-routingkey-parser')
const { kConsumeChannel } = require('./symbols')

class Message {
  constructor (message, { consumeChannel, noAck, types }) {
    this.startTime = Date.now()
    this.properties = message.properties
    this.fields = message.fields
    this.content = message.content

    this[kConsumeChannel] = consumeChannel
    this.noAck = noAck
    this.acked = false

    // TODO: make this parsing optional
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

    // Split routing key according to the types, e.g.
    // types: ['topic.*.*.hello']
    // routingKey: 'topic.some.thing.hello'
    // -> ['topic.some.thing.hello', 'some', 'thing']
    if (Array.isArray(types) && types.length > 0) {
      this.fields.parts = parseRoutingKeys(types, this.fields.routingKey)
    }
  }

  ack () {
    if (this.noAck || this.acked) {
      return
    }
    this.acked = true
    this[kConsumeChannel].ack(this)
  }

  nack () {
    if (this.noAck || this.acked) {
      return
    }
    this.acked = true
    this[kConsumeChannel].nack(this, false, true)
  }

  reject () {
    if (this.noAck || this.acked) {
      return
    }
    this.acked = true
    this[kConsumeChannel].nack(this, false, false)
  }

  toJSON () {
    return {
      fields: this.fields,
      properties: this.properties,
      body: this.body
    }
  }
}

const parser = new RoutingKeyParser()
function parseRoutingKeys (types, routingKey) {
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

module.exports = Message
