import { expectType } from 'tsd'
import { Mq, Message, Request } from '../../'

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
