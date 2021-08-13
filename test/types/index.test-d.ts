import { expectType } from 'tsd'
import Mq2 from '../..'
import Message from '../../types/message'
import Request from '../../types/request'

const mq = new Mq2({
  logger: console,
  topology: {
    connection: {}
  }
})

expectType<Mq2>(mq)

expectType<Promise<void>>(mq.handle({
  queue: 'queueName',
  async handler (message) {
    expectType<Message | Request>(message)
  }
}))
