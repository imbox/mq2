export class MqError extends Error {
  constructor (message) {
    super(message)
    this.name = 'MqError'
    this.code = 'MQ_ERR'
  }
}

export class MessageHandlerError extends MqError {
  constructor (message) {
    super(message)
    Error.captureStackTrace(this, MessageHandlerError)
    this.name = 'MessageHandlerError'
    this.message = message || 'Message Handler Error'
    this.code = 'MQ_ERR_MESSAGE_HANDLER'
  }
}

export class ReconnectTimeoutError extends MqError {
  constructor (message) {
    super(message)
    Error.captureStackTrace(this, ReconnectTimeoutError)
    this.name = 'ReconnectTimeoutError'
    this.message = message || 'Reconnect Timeout Error'
    this.code = 'MQ_ERR_RECONNECT_TIMEOUT'
  }
}

export class UnblockTimeoutError extends MqError {
  constructor (message) {
    super(message)
    Error.captureStackTrace(this, UnblockTimeoutError)
    this.name = 'UnblockTimeoutError'
    this.message = message || 'Unblock Timeout Error'
    this.code = 'MQ_ERR_UNBLOCK_TIMEOUT'
  }
}

export class RequestTimeoutError extends MqError {
  constructor (message) {
    super(message)
    Error.captureStackTrace(this, RequestTimeoutError)
    this.name = 'RequestTimeoutError'
    this.message = message || 'Request Timeout Error'
    this.code = 'MQ_ERR_REQUEST_TIMEOUT'
  }
}
