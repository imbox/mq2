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
    logger: any;
    topology: any;
    heartbeat: any;
    unhandledTimeout: number;
    requestTimeout: number;
    unblockTimeout: any;
    reconnectTimeout: any;
    reconnectTimeInSeconds: any;
    requests: any[];
    _consumerUnsubscribed: boolean;
    configure(): Promise<void>;
    publishConnection: any;
    publishChannel: any;
    consumeConnection: any;
    consumeChannel: any;
    shutdown(): Promise<void>;
    close(): Promise<void>;
    unsubscribeAll(): Promise<void>;
    handle(options: any): Promise<void>;
    publish(exchange: any, { body, routingKey, headers }: {
        body: any;
        routingKey: any;
        headers: any;
    }, options?: {}): Promise<void>;
    request(exchange: any, message: any, options: any): Promise<any>;
    _handleMessage(message: any, { handler }: {
        handler: any;
    }): Promise<void>;
    _publish(exchange: any, routingKey: any, content: any, options: any): Promise<void>;
    _onReply(message: any): Promise<void>;
    _createConnection(urlObj: any, socketOptions: any): Promise<any>;
    _createPublishChannel(connection: any, topology: any): Promise<any>;
    _createConsumeChannel(connection: any, topology: any): Promise<any>;
    _setupTopology(channel: any, topology: any, ...args: any[]): Promise<void>;
}
