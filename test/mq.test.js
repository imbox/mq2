'use strict'
const test = require('brittle')
const proxyquire = require('proxyquire').noCallThru()
const { FakeConnectionWrapper } = require('./fixtures')
const { Mq } = require('../')

const fakeAmqp = { AmqpConnectionManagerClass: FakeConnectionWrapper }

test('Mq', t => {
  t.execution(() => new Mq({ topology: { connection: {} } }))
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
  t.is(published.length, 1)

  t.is(published[0].options.correlationId.length, 36)
  delete published[0].options.correlationId

  t.alike(published, [
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
