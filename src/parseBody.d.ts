import { IncomingMessage } from 'http';

export {};

type Request = IncomingMessage & { body?: unknown };

export function parseBody(req: Request): Promise<{ [param: string]: unknown }>;
