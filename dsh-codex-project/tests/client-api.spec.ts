/**
 * Client spaces API tests: the fetch face over the host routes — payload
 * mapping, path encoding, and error surfacing (server message + network
 * failure).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createSpacesApi, SpacesApiError } from '../src/client/api.ts'

/** A minimal Response double. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

describe('createSpacesApi', () => {
  const api = createSpacesApi('/codex-project/api')
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('lists workspace records from the GET response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, spaces: { w1: { path: 'C:\\a', dirs: ['D:\\b'] } } }))
    expect(await api.list()).toEqual({ w1: { path: 'C:\\a', dirs: ['D:\\b'] } })
    expect(fetchMock).toHaveBeenCalledWith('/codex-project/api/dirs', expect.objectContaining({ method: 'GET' }))
  })

  it('gets one workspace dirs through the encoded id query', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, dirs: ['D:\\b'] }))
    expect(await api.getDirs('s/1')).toEqual(['D:\\b'])
    expect(fetchMock.mock.calls[0]![0]).toBe('/codex-project/api/dirs?workspaceId=s%2F1')
  })

  it('sets dirs with a JSON body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, dirs: ['D:\\b'] }))
    expect(await api.setDirs('s1', ['D:\\b'])).toEqual(['D:\\b'])
    const [, init] = fetchMock.mock.calls[0]!
    expect(init?.method).toBe('PUT')
    expect(init?.body).toBe(JSON.stringify({ workspaceId: 's1', dirs: ['D:\\b'] }))
  })

  it('opens a local directory through the plugin route', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }))
    await api.openDirectory('E:\\proj')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/codex-project/api/open-directory')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ path: 'E:\\proj' }))
  })

  it('surfaces the server error message with the status', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { ok: false, error: 'not an existing directory: X' }))
    await expect(api.setDirs('s1', ['X'])).rejects.toMatchObject({
      name: 'SpacesApiError',
      status: 400,
      message: 'not an existing directory: X',
    })
  })

  it('wraps network failures', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    await expect(api.list()).rejects.toBeInstanceOf(SpacesApiError)
    await expect(api.list()).rejects.toMatchObject({ status: 0 })
  })
})
