import type { Options } from 'amqplib'
import type { AmqpConnectionManagerOptions } from 'amqp-connection-manager'

interface Connection {
  /**
   * The to be used protocol
   *
   * Default value: 'amqp'
   */
  protocol?: string;
  /**
   * Hostname used for connecting to the server.
   *
   * Default value: 'localhost'
   */
  host?: string;
  /**
   * Port used for connecting to the server.
   *
   * Default value: 5672
   */
  port?: number;
  /**
   * Username used for authenticating against the server.
   *
   * Default value: 'guest'
   */
  user?: string;
  /**
   * Password used for authenticating against the server.
   *
   * Default value: 'guest'
   */
  pass?: string;
  /**
   * The desired locale for error messages. RabbitMQ only ever uses en_US
   *
   * Default value: 'en_US'
   */
  locale?: string;
  /**
   * The size in bytes of the maximum frame allowed over the connection. 0 means
   * no limit (but since frames have a size field which is an unsigned 32 bit integer, it’s perforce 2^32 - 1).
   *
   * Default value: 0x1000 (4kb) - That's the allowed minimum, it will fit many purposes
   */
  frameMax?: number;
  /**
   * The period of the connection heartbeat in seconds.
   *
   * Default value: 10
   */
  heartbeat?: number;
  /**
   * What VHost shall be used.
   *
   * Default value: '/'
   */
  vhost?: string;
}

interface Exchange extends Options.AssertExchange {
  /**
   * The name of the exchange.
   */
  name: string;
  /**
   * The exchange type
   */
  type: 'direct' | 'topic' | 'headers' | 'fanout' | 'match' | string;
}

interface Queue extends Options.AssertQueue {
  /**
   * The name of the queue
   */
  name: string;
}

interface Binding {
  /**
   * The name of the exchange to bind
   */
  exchange: string;
  /**
   * The name of the queue to bind
   */
  target: string;
  /**
   * Routing key patterns to bind
   */
  keys?: string[];
}

export type Topology = {
  connection: Connection;
  socketOptions?: AmqpConnectionManagerOptions['connectionOptions'];
  findServers?: AmqpConnectionManagerOptions['findServers'];
  replyQueue?: Queue;
  exchanges?: Exchange[];
  queues?: Queue[];
  bindings?: Binding[];
}
