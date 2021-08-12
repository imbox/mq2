import type { ChannelWrapper } from 'amqp-connection-manager'
import type {
  Message as AMQPMessage,
  MessageFields as AMQPMessageFields,
  MessageProperties
} from 'amqplib'

interface MessageFields extends AMQPMessageFields {
    parts?: string[];
}

export default class Message {
    constructor(message: AMQPMessage, { consumeChannel, noAck, types }: {
        consumeChannel: ChannelWrapper;
        noAck: boolean;
        types: string[];
    });
    noAck: boolean;
    properties: MessageProperties;
    fields: MessageFields;
    content: Buffer;
    startTime: number;
    acked: boolean;
    body: unknown;
    ack(): void;
    nack(): void;
    reject(): void;
    toJSON(): {
        fields: Message['fields'];
        properties: Message['properties'];
        body: Message['body'];
    };
}
