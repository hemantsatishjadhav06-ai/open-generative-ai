// Liveness probe for Railway's healthcheck (railway.json -> /api/health).
export const dynamic = 'force-dynamic';

export function GET() {
    return Response.json({ ok: true });
}
