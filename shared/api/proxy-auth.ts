export function getProxyAuthToken(request: Request): string | undefined {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return undefined
  return header.slice(7)
}
