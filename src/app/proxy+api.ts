/**
 * Proxy mínimo para la versión web: los servidores oficiales no envían cabeceras
 * CORS, así que el navegador no puede leerlos directo. Las apps de Android e iOS
 * no usan esta ruta. Solo reenvía pedidos GET a los hosts permitidos.
 */
const ALLOWED_HOSTS = [
  'www2.contingencias.mendoza.gov.ar',
  'agrometeo.mendoza.gov.ar',
  'ssl.smn.gob.ar',
];

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get('url');
  if (!target) return new Response('Falta el parámetro url', { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response('URL inválida', { status: 400 });
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.includes(parsed.hostname)) {
    return new Response('Host no permitido', { status: 403 });
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AlertaMendoza/1.0)' },
    });
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return new Response('No se pudo consultar la fuente', { status: 502 });
  }
}
