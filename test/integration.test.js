'use strict'
const { test } = require('node:test')
const { EventEmitter, once } = require('events')
const { Mq } = require('../')

const connection = {
  host: 'localhost',
  port: 5672,
  user: 'guest',
  pass: 'guest',
  heartbeat: 10
}

test('publish/consume json', { timeout: 2000 }, async t => {
  const exchanges = [{ name: 'ex', type: 'topic' }]
  const publisher = new Mq({
    topology: {
      connection,
      exchanges
    }
  })
  const consumer = new Mq({
    topology: {
      connection,
      exchanges,
      queues: [{ name: 'q', exclusive: true }],
      bindings: [
        {
          exchange: 'ex',
          target: 'q',
          keys: ['#']
        }
      ]
    }
  })

  t.after(async () => {
    await Promise.all([publisher.close(), consumer.close()])
  })

  await Promise.all([publisher.configure(), consumer.configure()])

  const ee = new EventEmitter()
  await consumer.handle({
    queue: 'q',
    prefetch: 1,
    noAck: false,
    types: ['*.*.#'], // Without this, message.fields.parts will be empty
    handler(message) {
      message.ack()
      ee.emit('message', message)
    }
  })

  const [messages] = await Promise.all([
    once(ee, 'message'),
    publisher.publish('ex', {
      routingKey: 'a.b.the.rest',
      body: { test: 'test' }
    })
  ])

  const message = messages[0]
  t.assert.equal(message.fields.exchange, 'ex')
  t.assert.equal(message.fields.routingKey, 'a.b.the.rest')
  t.assert.deepStrictEqual(message.fields.parts, [
    'a.b.the.rest',
    'a',
    'b',
    'the.rest'
  ])
  t.assert.equal(message.fields.redelivered, false)
  t.assert.equal(message.properties.contentType, 'application/json')
  t.assert.equal(message.properties.contentEncoding, 'utf8')
  t.assert.deepStrictEqual(
    message.content,
    Buffer.from(JSON.stringify({ test: 'test' }))
  )
})

test('request/response', { timeout: 2000 }, async t => {
  const exchanges = [{ name: 'request-ex', type: 'topic' }]
  const mq1 = new Mq({
    topology: {
      connection,
      exchanges,
      replyQueue: {
        name: 'reply-queue'
      }
    }
  })
  const mq2 = new Mq({
    topology: {
      connection,
      exchanges,
      queues: [{ name: 'my-request-queue', exclusive: true }],
      bindings: [
        {
          exchange: 'request-ex',
          target: 'my-request-queue',
          keys: ['#']
        }
      ]
    }
  })

  t.after(async () => {
    await Promise.allSettled([mq1.close(), mq2.close()])
  })

  await Promise.all([mq1.configure(), mq2.configure()])

  const ee = new EventEmitter()
  await mq2.handle({
    queue: 'my-request-queue',
    noAck: true,
    async handler(message) {
      await message.reply({
        b: 'b'
      })
      ee.emit('message', message)
    }
  })

  const [request, response] = await Promise.all([
    once(ee, 'message').then(messages => messages[0]),
    mq1.request(
      'request-ex',
      {
        routingKey: 'rkey',
        timeout: 1000,
        body: Buffer.from('a')
      },
      { contentType: 'text/plain' }
    )
  ])

  t.assert.equal(request.fields.exchange, 'request-ex')
  t.assert.equal(request.fields.redelivered, false)
  t.assert.equal(request.fields.routingKey, 'rkey')
  t.assert.equal(request.properties.contentType, 'text/plain')
  t.assert.equal(request.properties.replyTo, 'reply-queue')
  t.assert.equal(request.properties.expiration, '1000')
  t.assert.equal(request.body, 'a')
  t.assert.deepStrictEqual(request.content, Buffer.from('a'))
  t.assert.equal(response.fields.exchange, '')
  t.assert.equal(response.fields.redelivered, false)
  t.assert.equal(response.fields.routingKey, 'reply-queue')
  t.assert.equal(response.properties.contentType, 'application/json')
  t.assert.equal(response.properties.contentEncoding, 'utf8')
  t.assert.deepStrictEqual(response.body, { b: 'b' })
  t.assert.equal(response.content, null)
})
