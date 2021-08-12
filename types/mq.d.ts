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
   * Number of messages claim
   */
  prefetch?: number;
  exclusive?: boolean;
  noAck?: boolean;
  arguments?: unknown;
  handler: (message: Message | Request) => Promise<unknown>;
  onUncaughtException: (err: Error, message: Message | Request) => unknown;
}

export interface Logger {
  warn (msg: string, ...args: unknown[]): void;
}

export default class Mq2 {
    constructor({ topology, logger, unblockTimeout, reconnectTimeout, reconnectTime, unhandledTimeout, requestTimeout }: {
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
         * Time to wait for a blocked connection to unblock
         */
        unblockTimeout?: number;
        /**
         * How long to wait for a reconnect before throwing errors
         */
        reconnectTimeout?: number;
        /**
         * How long to wait until trying to connect after a disconnect
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
    publish(exchange: string, { body, routingKey, headers }: {
        body: unknown;
        routingKey?: string;
        headers?: unknown;
    }, options?: {}): Promise<void>;

    request(exchange: string, message: unknown, options?: unknown): Promise<Message>;
}
