import type { ChannelWrapper } from 'amqp-connection-manager'
import type {
  Message as AMQPMessage,
  MessageFields as AMQPMessageFields,
  MessageProperties
} from 'amqplib'

interface MessageFields extends AMQPMessageFields {
  /**
   * Parts parsed from the routing key, based on types provided during
   * `handle`
   */
  parts?: string[];
}

export default class Message {
  constructor(message: AMQPMessage, { consumeChannel, noAck, types }: {
    /**
     * The channel wrapper which is responsible for consuming messages
     */
    consumeChannel: ChannelWrapper;
    /**
     * If noAck is true, messages don't need to be acked/nacked
     */
    noAck: boolean;
    /**
     * Split routing keys based on these types
     */
    types: string[];
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
   * Used when stringifying instances of this class
   */
  toJSON(): {
    fields: Message['fields'];
    properties: Message['properties'];
    body: Message['body'];
  };
}
