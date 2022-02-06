import type { ChannelWrapper } from 'amqp-connection-manager'
import type {
  Message,
  MessageFields,
  MessageProperties,
  Options
} from 'amqplib'

export interface RequestReplyOptions {
  expiration?: number;
}

export default class Request {
  constructor(message: Message, { consumeChannel, publishChannel, noAck }: {
    /**
     * The channel wrapper which is responsible for consuming messages
     */
    consumeChannel: ChannelWrapper;
    /**
     * The channel wrapper which is responsible for publishing replies
     */
    publishChannel: ChannelWrapper;
    /**
     * If noAck is true, messages don't need to be acked/nacked
     */
    noAck: boolean;
  });
  /**
   * Message properties
   */
  properties: MessageProperties;
  /**
   * Message fields
   */
  fields: MessageFields;
  /**
   * Raw content of the message
   */
  content: Buffer;
  /**
   * Timestamp of when this consumer received the message
   */
  startTime: number;
  /**
   * The parsed content
   */
  body?: Buffer | string | unknown;
  /**
   * Ack messages when noAck = false, else noop
   */
  ack(): void;
  /**
   * Nack messages when noAck = false, else noop. Messages are requeued
   */
  nack(): void;
  /**
   * Nack messages when noAck = false, else noop. Messages are not requeued
   */
  reject(): void;
  /**
   * Send a reply to the received request
   * 
   * @param body - body of reply
   * @param options - publish options
   */
  reply(body: unknown, options: Options.Publish): Promise<void>;
  /**
   * Used when stringifying instances of this class
   */
  toJSON(): {
    fields: MessageFields;
    properties: MessageProperties;
    body: unknown;
  };
}
