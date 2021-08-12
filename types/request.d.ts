import type { ChannelWrapper } from 'amqp-connection-manager'
import type { Message, MessageFields, MessageProperties } from 'amqplib'

export interface RequestReplyOptions {
    expiration?: number;
}

export default class Request {
    constructor(message: Message, { consumeChannel, publishChannel, noAck }: {
        consumeChannel: ChannelWrapper;
        publishChannel: ChannelWrapper;
        noAck: boolean;
    });
    noAck: boolean;
    properties: MessageProperties;
    fields: MessageFields;
    content: Buffer;
    body: unknown;
    startTime: number;
    replied: boolean;
    acked: boolean;
    ack(): void;
    nack(): void;
    reject(): void;
    reply(body: unknown, options: RequestReplyOptions): Promise<void>;
    toJSON(): {
        fields: MessageFields;
        properties: MessageProperties;
        body: unknown;
    };
}
