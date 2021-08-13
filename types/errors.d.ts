export class MqError extends Error {
  constructor(message: any);
  code: string;
}
export class MessageHandlerError extends MqError {
}
export class ReconnectTimeoutError extends MqError {
}
export class UnblockTimeoutError extends MqError {
}
export class RequestTimeoutError extends MqError {
}
