import { ChannelWrapper } from 'amqp-connection-manager'
import { Message } from './message'

export interface HandleOptions {
  handler: (message: Message) => Promise<void>
}

export default class Mq2 {
    constructor({ topology, logger, unblockTimeout, reconnectTimeout, reconnectTime, unhandledTimeout, requestTimeout }: {
        topology: any;
        logger: any;
        unblockTimeout: any;
        reconnectTimeout: any;
        reconnectTime: any;
        unhandledTimeout?: number;
        requestTimeout?: number;
    });
    configure(): Promise<void>;
    shutdown(): Promise<void>;
    close(): Promise<void>;
    unsubscribeAll(): Promise<void>;
    handle(options: HandleOptions): Promise<void>;
    publish(exchange: any, { body, routingKey, headers }: {
        body: any;
        routingKey: any;
        headers: any;
    }, options?: {}): Promise<void>;
    request(exchange: any, message: any, options: any): Promise<any>;
}
