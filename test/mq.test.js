const proxyquire = require('proxyquire')
const { test } = require('tap')
const { fakeAmqpConnectionManager } = require('./fixtures')

const Mq = proxyquire('../lib/mq', {
  'amqp-connection-manager': fakeAmqpConnectionManager
})

test('Mq', t => {
  t.plan(1)
  t.doesNotThrow(() => new Mq({ topology: { connection: {} } }))
})

test('configure', async () => {
  const mq = new Mq({ topology: { connection: {} } })
  await mq.configure()
})
