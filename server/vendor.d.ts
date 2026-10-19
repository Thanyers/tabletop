declare module 'pg' {
  export interface QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
    rows: Row[];
    rowCount: number | null;
  }

  export interface PoolClient {
    query<Row extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<Row>>;
    release(): void;
  }

  export class Pool {
    constructor(options: { connectionString: string; max: number });
    query<Row extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<Row>>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }
}

declare module 'ws' {
  import type { IncomingMessage } from 'node:http';
  import type { Duplex } from 'node:stream';
  import type { EventEmitter } from 'node:events';

  export interface WebSocket extends EventEmitter {
    readonly readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
    ping(): void;
  }

  export interface WebSocketServer extends EventEmitter {
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, callback: (socket: WebSocket) => void): void;
    close(callback?: (error?: Error) => void): void;
  }

  export const WebSocket: {
    readonly OPEN: number;
  };

  export class WebSocketServer {
    constructor(options: {
      noServer: true;
      maxPayload: number;
      perMessageDeflate: false;
      clientTracking: false;
    });
    readonly clients: Set<WebSocket>;
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, callback: (socket: WebSocket) => void): void;
    close(callback?: (error?: Error) => void): void;
    on(event: 'connection', listener: (socket: WebSocket, request: IncomingMessage) => void): this;
  }
}
