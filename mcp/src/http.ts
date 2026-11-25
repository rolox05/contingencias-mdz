import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';

import { createApiClient } from './api';
import { createMcpServer, VERSION } from './server';

/**
 * Servidor MCP remoto (Streamable HTTP, sin sesiones) en su propio puerto.
 * Cada pedido crea un servidor liviano: no guarda estado entre llamadas.
 *
 * Variables: MCP_PORT (8788), MCP_HOST (127.0.0.1; usar 0.0.0.0 detrás de un
 * proxy), MCP_ALLOWED_HOSTS (lista separada por comas para validar Host),
 * ALERTA_API_URL (http://localhost:8787).
 */
const port = Number(process.env.MCP_PORT ?? 8788);
const host = process.env.MCP_HOST ?? '127.0.0.1';
const allowedHosts = process.env.MCP_ALLOWED_HOSTS?.split(',').map((h) => h.trim()).filter(Boolean);
const api = createApiClient(process.env.ALERTA_API_URL ?? 'http://localhost:8787');

const app = createMcpExpressApp({ host, ...(allowedHosts?.length ? { allowedHosts } : {}) });

app.post('/mcp', async (req: Request, res: Response) => {
  const server = createMcpServer(api);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error en pedido MCP:', error);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
});

// Sin sesiones no hay flujo de notificaciones por GET ni cierre de sesión.
const notAllowed = (_req: Request, res: Response) => {
  res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
};
app.get('/mcp', notAllowed);
app.delete('/mcp', notAllowed);

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, version: VERSION });
});

app.listen(port, host, () => {
  console.log(`Alerta Mendoza MCP en http://${host}:${port}/mcp (API: ${process.env.ALERTA_API_URL ?? 'http://localhost:8787'})`);
});
