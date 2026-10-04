/**
 * Dependency-free HTTP(S) JSON client: timeout, one retry, redirects, and a
 * small TTL cache. Uses node:http(s) so it never depends on a global fetch.
 */
import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'

const CACHE = new Map()
const CACHE_MAX = 200

function remember(key, entry) {
  if (CACHE.size >= CACHE_MAX) {
    const oldest = CACHE.keys().next().value
    if (oldest !== undefined) CACHE.delete(oldest)
  }
  CACHE.set(key, entry)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function short(text, max = 200) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** Pull a useful message out of an error body (Open-Meteo uses {reason}). */
function errorDetail(body) {
  if (!body) return ''
  try {
    const json = JSON.parse(body)
    const detail = json?.reason ?? json?.error ?? json?.message
    if (typeof detail === 'string' && detail) return short(detail)
  } catch {
    /* not JSON */
  }
  return short(body)
}

function requestOnce(url, { timeoutMs, headers, signal }) {
  return new Promise((resolve, reject) => {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      reject(new Error(`无效的 URL：${url}`))
      return
    }
    const lib = parsed.protocol === 'http:' ? http : https
    const req = lib.request(
      parsed,
      {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'accept-encoding': 'identity',
          'user-agent': 'dsh-plugin-weather/0.1.0',
          ...headers,
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          finish()
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )

    const onAbort = () => req.destroy(new Error('请求已被取消'))
    const finish = () => signal?.removeEventListener?.('abort', onAbort)
    if (signal) {
      if (signal.aborted) {
        req.destroy(new Error('请求已被取消'))
        return
      }
      signal.addEventListener?.('abort', onAbort, { once: true })
    }

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`请求超时（${timeoutMs} ms）`))
    })
    req.on('error', (error) => {
      finish()
      reject(error)
    })
    req.end()
  })
}

/**
 * GET a JSON document.
 * @param {string} url
 * @param {{timeoutMs?: number, cacheTtlMs?: number, retries?: number, headers?: Record<string,string>, signal?: AbortSignal}} options
 */
export async function getJson(url, options = {}) {
  const {
    timeoutMs = 15000,
    cacheTtlMs = 0,
    retries = 1,
    headers,
    signal,
  } = options

  if (cacheTtlMs > 0) {
    const hit = CACHE.get(url)
    if (hit && hit.expires > Date.now()) return hit.value
  }

  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw new Error('请求已被取消')
    try {
      let target = url
      let response
      for (let hop = 0; hop < 4; hop += 1) {
        response = await requestOnce(target, { timeoutMs, headers, signal })
        if (response.status >= 300 && response.status < 400 && response.location) {
          target = new URL(response.location, target).toString()
          continue
        }
        break
      }
      if (response.status < 200 || response.status >= 300) {
        const detail = errorDetail(response.body)
        const error = new Error(`HTTP ${response.status}${detail ? ` — ${detail}` : ''}`)
        error.status = response.status
        error.retryable = response.status >= 500 || response.status === 429
        throw error
      }
      let json
      try {
        json = JSON.parse(response.body)
      } catch {
        throw new Error(`上游返回的不是合法 JSON：${short(response.body, 120)}`)
      }
      if (json && typeof json === 'object' && json.error && json.reason) {
        const error = new Error(`上游报错：${short(json.reason)}`)
        error.retryable = false
        throw error
      }
      if (cacheTtlMs > 0) remember(url, { expires: Date.now() + cacheTtlMs, value: json })
      return json
    } catch (error) {
      lastError = error
      if (attempt < retries && error?.retryable !== false) {
        await sleep(250 * (attempt + 1))
        continue
      }
      break
    }
  }
  throw lastError ?? new Error('请求失败')
}
