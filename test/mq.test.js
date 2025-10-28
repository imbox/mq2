'use strict'
const { mock, test } = require('node:test')
const { setTimeout, setImmediate } = require('node:timers/promises')
const proxyquire = require('proxyquire').noCallThru()
const { FakeConnectionWrapper } = require('./fixtures')
const { Mq } = require('../')

const fakeAmqp = { AmqpConnectionManagerClass: FakeConnectionWrapper }

test('Mq', t => {
  t.assert.doesNotThrow(() => new Mq({ topology: { connection: {} } }))
})

test('configure', async t => {
  const Mq = proxyquire('../lib/mq', {
    'amqp-connection-manager': fakeAmqp
  })
  const mq = new Mq({ topology: { connection: {} } })
  await mq.configure()
  t.assert.ok(mq.publishConnection)
  t.assert.ok(mq.consumeConnection)
})

test('publish', async t => {
  const Mq = proxyquire('../lib/mq', {
    'amqp-connection-manager': fakeAmqp
  })
  const mq = new Mq({ topology: { connection: {} } })
  await mq.configure()

  const body = { test: 'test' }
  await mq.publish('exchange', {
    routingKey: 'routingKey',
    body
  })

  const published = mq.publishConnection.channel.published
  t.assert.equal(published.length, 1)

  t.assert.equal(published[0].options.correlationId.length, 36)
  delete published[0].options.correlationId

  t.assert.deepStrictEqual(published, [
    {
      exchange: 'exchange',
      routingKey: 'routingKey',
      content: Buffer.from(JSON.stringify(body)),
      options: {
        headers: undefined,
        contentEncoding: 'utf8',
        contentType: 'application/json',
        timeout: 5000
      }
    }
  ])
})

test('consume defaults', async t => {
  const Mq = proxyquire('../lib/mq', {
    'amqp-connection-manager': fakeAmqp
  })
  const mq = new Mq({ topology: { connection: {} } })
  await mq.configure()

  await mq.handle({
    queue: 'queueName',
    handler: async message => {
      message.ack()
    }
  })

  t.assert.deepStrictEqual(mq.consumeConnection.channel.consumers[0].options, {
    arguments: undefined,
    exclusive: false,
    noAck: false,
    prefetch: 10
  })
  t.assert.equal(
    mq.consumeConnection.channel.consumers[0].queueName,
    'queueName'
  )
})

test('handle message', async t => {
  const Mq = proxyquire('../lib/mq', {
    'amqp-connection-manager': fakeAmqp
  })
  const mq = new Mq({ topology: { connection: {} } })
  await mq.configure()

  let message
  const { promise, resolve } = Promise.withResolvers()
  await mq.handle({
    queue: 'queueName',
    handler: async _message => {
      message = _message
      message.ack()
      await setImmediate()
      resolve()
    }
  })

  await mq.consumeConnection.channel.consumers[0].onMessage({
    fields: {},
    properties: { contentType: 'application/json' },
    content: Buffer.from(JSON.stringify({ type: 'message' }))
  })

  await promise
  t.assert.deepStrictEqual(message.body, { type: 'message' })
  t.assert.equal(message.acked, true)
})

test('unhandledTimeout', async t => {
  const Mq = proxyquire('../lib/mq', {
    'amqp-connection-manager': fakeAmqp
  })
  const mq = new Mq({ topology: { connection: {} } })
  await mq.configure()

  mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => {
    mock.timers.reset()
  })

  const { promise, resolve } = Promise.withResolvers()
  await mq.handle({
    queue: 'queueName',
    unhandledTimeout: 10_000,
    onUncaughtException: (err, message) => {
      message.reject()
      resolve(err)
    },
    handler: async _message => {
      mock.timers.tick(10_100)
      await setTimeout(20_000, {}, { ref: false })
    }
  })

  await mq.consumeConnection.channel.consumers[0].onMessage({
    fields: {},
    properties: { contentType: 'application/json' },
    content: Buffer.from(JSON.stringify({ type: 'message' }))
  })

  const err = await promise
  t.assert.equal(err.message, 'Timeout')
  t.assert.equal(err.code, 'MQ_ERR_MESSAGE_HANDLER')
})
