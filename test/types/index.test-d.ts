import { expectType } from 'tsd'
import DefaultMq, { Mq, Message, Request, Topology } from '../../'

const topology: Topology = {
    connection: {
      host: 'localhost',
      port: 5672,
      user: 'guest',
      pass: 'guest',
      heartbeat: 10
    },
    socketOptions: {
      clientProperties: {
        something: 'something'
      }
    },
    exchanges: [
      {
        name: 'exchange-name',
        type: 'topic',
        durable: true,
        autoDelete: false,
        arguments: {
          custom: 'arguments'
        }
      }
    ],
    queues: [
      {
        name: 'queue-name',
        durable: true,
        autoDelete: false
      }
    ],
    bindings: [
      {
        exchange: 'exchange-name',
        target: 'queue-name',
        keys: [
          'matching.routingkey.*'
        ]
      }
    ]
  }

const mq = new Mq({
  logger: console,
  topology
})

expectType<Mq>(mq)

expectType<Promise<void>>(mq.handle({
  queue: 'queueName',
  async handler (message) {
    expectType<Message | Request>(message)
  }
}))

const dmq = new DefaultMq({
  logger: console,
  topology
})

expectType<Mq>(dmq)

