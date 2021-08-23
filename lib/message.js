'use strict'

const RoutingKeyParser = require('rabbit-routingkey-parser')
const { kAcked, kConsumeChannel, kNoAck } = require('./symbols')

class Message {
  constructor (message, { consumeChannel, noAck, types }) {
    this.startTime = Date.now()
    this.properties = message.properties
    this.fields = message.fields
    this.content = message.content

    this[kConsumeChannel] = consumeChannel
    this[kNoAck] = noAck
    this[kAcked] = false

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
    } else {
      this.fields.parts = []
    }
  }

  ack () {
    if (this[kNoAck] || this[kAcked]) {
      return
    }
    this[kAcked] = true
    this[kConsumeChannel].ack(this)
  }

  nack () {
    if (this[kNoAck] || this[kAcked]) {
      return
    }
    this[kAcked] = true
    this[kConsumeChannel].nack(this, false, true)
  }

  reject () {
    if (this[kNoAck] || this[kAcked]) {
      return
    }
    this[kAcked] = true
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
