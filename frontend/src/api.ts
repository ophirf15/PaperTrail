export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Options = {
  method?: string
  json?: unknown
  form?: FormData
  signal?: AbortSignal
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  let body: BodyInit | undefined
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.json)
  } else if (options.form) {
    body = options.form
  }
  const response = await fetch(path, { method: options.method ?? 'GET', headers, body, credentials: 'same-origin', signal: options.signal })
  if (response.status === 401 && path !== '/api/login' && path !== '/api/me' && path !== '/api/setup-status') {
    window.dispatchEvent(new Event('pt-unauthorized'))
  }
  if (!response.ok) {
    let message = 'The journal could not complete that.'
    try {
      const data = (await response.json()) as { error?: string }
      if (data.error) message = data.error
    } catch {
      message = response.statusText || message
    }
    throw new ApiError(response.status, message)
  }
  if (response.status === 204) return undefined as T
  const disposition = response.headers.get('Content-Disposition') ?? ''
  if (disposition.includes('attachment')) {
    return (await response.blob()) as T
  }
  return (await response.json()) as T
}

const crumbs: { at: string; label: string }[] = []

export function crumb(label: string) {
  crumbs.push({ at: new Date().toISOString(), label })
  if (crumbs.length > 20) crumbs.shift()
}

export function reportError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown error'
  const stack = error instanceof Error ? error.stack : undefined
  const url = `${location.origin}${location.pathname}`
  void api('/api/errors', { method: 'POST', json: { message, stack, url, breadcrumbs: crumbs } }).catch(() => undefined)
}
