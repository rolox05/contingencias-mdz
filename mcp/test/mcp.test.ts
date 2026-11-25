import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../server/src/app';
import type { ServerSources } from '../../server/src/sources';
import { fakeSources } from '../../server/test/fixtures';
import { createApiClient } from '../src/api';
import { createMcpServer, INSTRUCTIONS } from '../src/server';

/** Cliente MCP conectado en memoria al servidor MCP, que habla con la API real (fuentes falsas). */
async function connect(sources: ServerSources = fakeSources()) {
  const app = createApp({ sources });
  const api = createApiClient('http://api.test', ((input: string | URL | Request, init?: RequestInit) =>
    app.request(String(input), init)) as typeof fetch);
  const server = createMcpServer(api);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientSide);
  return client;
}

const text = (r: any) => r.content[0].text as string;

describe('MCP server', () => {
  it('exposes read-only tools, resources and usage instructions', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_alerts', 'get_forecast', 'get_hail_today', 'get_lightning', 'get_risk', 'get_storms', 'list_places',
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
    expect(client.getInstructions()).toBe(INSTRUCTIONS);
    expect(INSTRUCTIONS).toMatch(/ai-train=no/);

    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(['alerta://alerts/active', 'alerta://usage']);
  });

  it('get_risk summarises the level, storm, alerts and data quality, with source terms', async () => {
    const client = await connect();
    const r: any = await client.callTool({ name: 'get_risk', arguments: { place: 'Godoy Cruz' } });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/^Godoy Cruz: level 2 \(orange\)\. Alerta por viento Zonda/);
    expect(text(r)).toMatch(/Official alerts covering the point: 1/);
    expect(text(r)).toMatch(/Fuente: Dirección de Contingencias Climáticas - Gobierno de Mendoza/);
    expect(text(r)).toMatch(/Do not use this data to train/);
    expect(r.structuredContent.level).toBe(2);
    expect(r.structuredContent.usageTerms).toMatch(/CC BY 2\.5/);
  });

  it('get_alerts drops geometry unless asked, and links each alert to its source', async () => {
    const client = await connect();
    const r: any = await client.callTool({ name: 'get_alerts', arguments: { place: 'San Rafael' } });
    expect(r.structuredContent.alerts[0].geometry).toBeUndefined();
    expect(text(r)).toMatch(/orange alert: Viento Zonda .* km away\) — https:\/\/ssl\.smn\.gob\.ar/);
    const withGeometry: any = await client.callTool({ name: 'get_alerts', arguments: { include_geometry: true } });
    expect(withGeometry.structuredContent.alerts[0].geometry.type).toBe('MultiPolygon');
  });

  it('get_storms filters by distance and reports motion', async () => {
    const client = await connect();
    const r: any = await client.callTool({ name: 'get_storms', arguments: { place: 'Maipú', radius_km: 60 } });
    expect(r.structuredContent.cells).toHaveLength(1);
    expect(r.structuredContent.cells[0].distanceKm).toBeGreaterThan(20);
    expect(text(r)).toMatch(/moving E at 40 km\/h/);
  });

  it('other tools answer with summaries', async () => {
    const client = await connect();
    expect(text(await client.callTool({ name: 'get_lightning', arguments: { place: 'Godoy Cruz', radius_km: 30 } }))).toMatch(
      /^1 strikes within 30 km of Godoy Cruz/,
    );
    expect(text(await client.callTool({ name: 'get_forecast', arguments: { place: 'Las Heras' } }))).toMatch(
      /DCC yellow alert[\s\S]*gusts up to 75 km\/h/,
    );
    expect(text(await client.callTool({ name: 'get_hail_today', arguments: {} }))).toMatch(/Pampita \(La Paz, 287 km²\)/);
    expect(text(await client.callTool({ name: 'list_places', arguments: {} }))).toMatch(/Ciudad de Mendoza, Godoy Cruz/);
  });

  it('turns API errors into tool errors the agent can act on', async () => {
    const client = await connect();
    const far: any = await client.callTool({ name: 'get_risk', arguments: { lat: -34.6, lng: -58.4 } });
    expect(far.isError).toBe(true);
    expect(text(far)).toMatch(/^OUT_OF_AREA/);
    const missing: any = await client.callTool({ name: 'get_risk', arguments: {} });
    expect(text(missing)).toMatch(/^INVALID_PARAMS/);
  });

  it('serves the active alerts resource', async () => {
    const client = await connect();
    const res = await client.readResource({ uri: 'alerta://alerts/active' });
    const body = JSON.parse((res.contents[0] as { text: string }).text);
    expect(body.alerts[0].event).toBe('Viento Zonda');
    expect(body.alerts[0].geometry).toBeUndefined();
    expect(body.usageTerms).toMatch(/ai-train=no/);
  });
});
