export function getHealth() {
  return {
    status: 'ok',
    service: 'advance-academy-backend',
    adapter: 'fastify',
    timestamp: new Date().toISOString(),
  };
}
