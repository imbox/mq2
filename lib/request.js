'use strict'

const { MessageHandlerError } = require('./errors')
const { kConsumeChannel, kPublishChannel } = require('./symbols')
const { createContentFromBody } = require('./utils')

class Request {
  constructor (message, { consumeChannel, publishChannel, noAck }) {
    this.startTime = Date.now()
    this.properties = message.properties
    this.fields = message.fields
    this.content = message.content

    this[kConsumeChannel] = consumeChannel
    this[kPublishChannel] = publishChannel
    this.noAck = noAck
    this.acked = false
    this.replied = false

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
  }

  ack () {
    if (this.noAck || this.acked) {
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
    if (this.noAck || this.acked) {
      return
    }
    this.acked = true
    this[kConsumeChannel].nack(this, false, false)
  }

  async reply (body, options) {
    if (this.replied) {
      throw new MessageHandlerError('Multiple replies')
    }
    if (typeof this.properties.replyTo !== 'string') {
      throw new MessageHandlerError('Missing replyTo')
    }
    if (typeof this.properties.correlationId !== 'string') {
      throw new MessageHandlerError('Missing correlationId')
    }
    if (body == null) {
      throw new MessageHandlerError('Missing body')
    }

    // Message can be expired while sending reply...
    this.ack()
    this.replied = true

    const correlationId = this.properties.correlationId
    const replyTo = this.properties.replyTo

    const opts = {
      contentType: 'application/json',
      contentEncoding: 'utf8',
      correlationId,
      ...options
    }

    const content = createContentFromBody(body, opts.contentType)
    return this[kPublishChannel].sendToQueue(replyTo, content, opts)
  }

  toJSON () {
    return {
      fields: this.fields,
      properties: this.properties,
      body: this.body
    }
  }
}

module.exports = Request
