'use strict'
const { test } = require('node:test')
const { setTimeout: sleep } = require('node:timers/promises')
const { EventEmitter, once } = require('node:events')
const { Mq } = require('../')

const connection = {
  host: 'localhost',
  port: 5672,
  user: 'guest',
  pass: 'guest',
  heartbeat: 10
}

async function rabbitRequest({ path, headers, method = 'GET' }) {
  const response = await fetch(`http://localhost:15672/api${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${connection.user}:${connection.pass}`).toString('base64')}`,
      ...headers
    }
  })
  if (response.status === 204) {
    return null
  } else {
    return response.json()
  }
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

test('request/response - timeout', { timeout: 2000 }, async t => {
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

  await mq2.handle({
    queue: 'my-request-queue',
    noAck: true,
    async handler(_message) {
      // Let it timeout
    }
  })

  let error
  try {
    await mq1.request(
      'request-ex',
      {
        routingKey: 'rkey',
        timeout: 100,
        body: Buffer.from('a')
      },
      { contentType: 'text/plain' }
    )
  } catch (err) {
    error = err
  }
  t.assert.equal(error.name, 'RequestTimeoutError')
  t.assert.equal(error.code, 'MQ_ERR_REQUEST_TIMEOUT')
})

test('handle connection error code 320', { timeout: 6000 }, async t => {
  // On error code 320, reconnection should happen immediately and findServers
  // should always be called, even though there might be urls that
  // amqp-connection-manager haven't tried yet
  let findServersCalled = 0
  const mq = new Mq({
    reconnectTime: 10e3,
    topology: {
      connection,
      exchanges: [],
      queues: [],
      bindings: []
    },
    findServers() {
      findServersCalled++
      return [connection, connection]
    }
  })

  t.after(async () => {
    await mq.close()
  })

  await mq.configure()

  // Wait at least 5 seconds to guarantee that connections can be retrieved
  // from the http api
  await sleep(5000)

  const connections = await rabbitRequest({ path: '/connections' })
  t.assert.equal(connections.length, 2)

  await Promise.all(
    connections.map(conn =>
      rabbitRequest({
        method: 'DELETE',
        path: `/connections/${encodeURIComponent(conn.name)}`,
        headers: { 'X-Reason': 'Migration to new cluster' }
      })
    )
  )

  t.assert.ok(!mq.publishConnection.isConnected())
  t.assert.ok(!mq.consumeConnection.isConnected())

  // Wait for connections to reconnect, but not as long as reconnectTime
  await sleep(500)

  t.assert.ok(mq.publishConnection.isConnected())
  t.assert.ok(mq.consumeConnection.isConnected())
  t.assert.equal(findServersCalled, 4)
})
