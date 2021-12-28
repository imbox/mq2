import { expectType } from 'tsd'
import DefaultMq, { Mq, Message, Request } from '../../'

const mq = new Mq({
  logger: console,
  topology: {
    connection: {}
  }
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
  topology: {
    connection: {}
  }
})

expectType<Mq>(dmq)

