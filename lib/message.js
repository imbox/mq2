import RoutingKeyParser from 'rabbit-routingkey-parser'
import { kConsumeChannel } from './symbols.js'

export default class Message {
  constructor (message, { consumeChannel, noAck, types }) {
    this.noAck = noAck
    this.properties = message.properties
    this.fields = message.fields
    this.content = message.content
    this.startTime = Date.now()

    this[kConsumeChannel] = consumeChannel
    this.acked = false

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
    if (this._noAck || this.acked) {
      return
    }
    this.acked = true
    this[kConsumeChannel].ack(this)
  }

  nack () {
    if (this._noAck || this.acked) {
      return
    }
    this.acked = true
    this[kConsumeChannel].nack(this, false, true)
  }

  reject () {
    if (this._noAck || this.acked) {
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
