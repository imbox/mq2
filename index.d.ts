import Mq2 from './types/mq.js'
import Message from './types/message'
import Request from './types/request'
import errors from './types/errors.js'

export {
  Message,
  Request,
  errors
}

export default Mq2

declare namespace Mq2 {
  var Message: typeof import('./types/message');
  var Request: typeof import('./types/message');
  var errors: typeof import('./types/errors');
}
