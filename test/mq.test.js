'use strict'

const proxyquire = require('proxyquire').noCallThru()
const { test } = require('tap')
const { FakeConnectionWrapper } = require('./fixtures')
const { Mq } = require('../')

const fakeAmqp = { AmqpConnectionManagerClass: FakeConnectionWrapper }

test('Mq', t => {
  t.plan(1)
  t.doesNotThrow(() => new Mq({ topology: { connection: {} } }))
})

test('configure', async t => {
  const Mq = proxyquire('../lib/mq', {
    'amqp-connection-manager': fakeAmqp
  })
  const mq = new Mq({ topology: { connection: {} } })
  await mq.configure()
  t.ok(mq.publishConnection)
  t.ok(mq.consumeConnection)
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
  t.equal(published.length, 1)

  t.equal(published[0].options.correlationId.length, 36)
  delete published[0].options.correlationId

  t.strictSame(published, [
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
