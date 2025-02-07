import { MessagePropertyHeaders } from 'amqplib'
import {
  AmqpConnectionManager,
  AmqpConnectionManagerOptions,
  ChannelWrapper,
  Options
} from 'amqp-connection-manager'
import Message from './message'
import Request from './request'
import { Topology } from './topology'

export interface HandleOptions {
  /**
   * Name of the queue to process messages from
   */
  queue: string;
  /**
   * Break up routing keys based on pattern provided here. Results are stored in
   * message.properties.parts
   */
  types?: string[];
  /**
   * Number of messages to claim concurrently
   */
  prefetch?: number;
  /**
   * Time to wait for message handler to finish. Overwrites the default
   * unhandledTimeout set on Mq
   */
  unhandledTimeout?: number;
  /**
   * Exclusive consumer - first consumer is the only one able to consume from
   * queue
   * https://www.rabbitmq.com/consumers.html
   */
  exclusive?: boolean;
  /**
   * If true - messages are automatically acked when received
   * https://www.rabbitmq.com/consumers.html
   */
  noAck?: boolean;
  /**
   * Custom arguments, e.g. "x-single-active-consumer": true
   * https://www.rabbitmq.com/consumers.html
   */
  arguments?: unknown;
  /**
   * Called just before the message handler
   */
  preHandler?: (message: Message | Request) => Promise<void> | void;
  /**
   * Your custom message handler
   */
  handler: (message: Message | Request) => Promise<void> | void;
  /**
   * Called on e.g. message handling timeout
   */
  onUncaughtException?: (err: Error, message: Message | Request) => void;
}

export interface PublishMessage {
  body: Buffer | string | unknown;
  routingKey?: string;
  headers?: MessagePropertyHeaders;
}

export interface PublishRequest extends PublishMessage {
  timeout?: number;
}

export interface Logger {
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export default class Mq {
  constructor({ topology, logger, socketTimeout, unblockTimeout, reconnectTimeout, reconnectTime, unhandledTimeout, requestTimeout }: {
    /**
     * A topology which will be created if it not already exists. It also
     * contains all connection options
     */
    topology: Topology;

    /**
     * A custom logger
     */
    logger?: Logger;

    /**
     * A custom function to find servers to connect to
     */
    findServers?: AmqpConnectionManagerOptions['findServers'];

    /**
     * Create confirm channel or not. (default false)
     * Every message published with a confirm channel is acked/nacked by RabbitMq
     */
    confirm?: boolean;

    /**
     * How long to wait for each connection attempt (ms)
     * Overwrites any timeout set in topology.socketOptions.timeout
     * Default: 5000 ms
     */
    socketTimeout?: number;

    /**
     * Time to wait for a blocked connection to unblock
     */
    unblockTimeout?: number;

    /**
     * How long to wait for any connection attempt to succeed before emitting
     * errors
     */
    reconnectTimeout?: number;

    /**
     * How long to wait until trying to reconnect after a disconnect
     */
    reconnectTime?: number;

    /**
     * How long to wait for message handle completion before rejecting the
     * message
     */
    unhandledTimeout?: number;

    /**
     * How long to wait for a rpc request reply
     */
    requestTimeout?: number;

    /**
     * How long to wait for message to be published to RabbitMQ
     */
    publishTimeout?: number;
  });

  /**
   * Connect to RabbitMQ and assert topology
   */
  configure(): Promise<void>;

  /**
   * Close connection to RabbitMQ
   */
  shutdown(): Promise<void>;

  /**
   * Close connection to RabbitMQ
   */
  close(): Promise<void>;

  /**
   * Cancel subscription to all RabbitMQ queues
   */
  unsubscribeAll(): Promise<void>;

  /**
   * Subscribe to queue messages
   */
  handle(options: HandleOptions): Promise<void>;

  /**
   * Publish a message to RabbitMQ
   */
  publish(exchange: string, message: PublishMessage, options?: Options.Publish & { timeout?: number }): Promise<void>;

  /**
   * Publish an rpc message - a response is expected
   */
  request(exchange: string, message: PublishRequest, options?: Options.Publish & { timeout?: number }): Promise<Message>;

  /**
   * Connection used read messages
   */
  consumeConnection: AmqpConnectionManager | null

  /**
   * The currently connected channel used for reading messages
   */
  consumeChannel: ChannelWrapper | null

  /**
   * Connection used to write messages
   */
  publishConnection: AmqpConnectionManager | null

  /**
   * The currently connected channel used for writing messages
   */
  publishChannel: ChannelWrapper | null
}
