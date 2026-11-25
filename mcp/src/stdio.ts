import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createApiClient } from './api';
import { createMcpServer } from './server';

/**
 * Servidor MCP local por stdio (para clientes que lanzan el proceso, como Claude
 * Desktop o Claude Code). Usa la misma API que la versión HTTP: ALERTA_API_URL.
 * No escribe nada por stdout: ese canal es del protocolo.
 */
const api = createApiClient(process.env.ALERTA_API_URL ?? 'http://localhost:8787');
const server = createMcpServer(api);
await server.connect(new StdioServerTransport());
