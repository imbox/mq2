'use strict'

const proxyquire = require('proxyquire').noCallThru()
const { test } = require('tap')
const { FakeAmqpConnectionManager } = require('./fixtures')
const { Mq } = require('../')

test('Mq', t => {
  t.plan(1)
  t.doesNotThrow(() => new Mq({ topology: { connection: {} } }))
})

test('configure', async () => {
  const Mq = proxyquire('../lib/mq', {
    'amqp-connection-manager': new FakeAmqpConnectionManager()
  })
  const mq = new Mq({ topology: { connection: {} } })
  await mq.configure()
})

test('publish', async () => {
  const Mq = proxyquire('../lib/mq', {
    'amqp-connection-manager': new FakeAmqpConnectionManager()
  })

  const mq = new Mq({ topology: { connection: {} } })
  await mq.configure()
  await mq.publish('exchange', {
    routingKey: 'routingkey',
    body: { test: 'test' }
  })
})
