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

  it('lists spaces from the GET response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, spaces: [{ id: 's1', roots: ['C:\\a'] }] }))
    expect(await api.list()).toEqual([{ id: 's1', roots: ['C:\\a'] }])
    expect(fetchMock).toHaveBeenCalledWith('/codex-project/api/spaces', expect.objectContaining({ method: 'GET' }))
  })

  it('creates a space with a JSON body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { ok: true, space: { id: 's2', title: 'x', roots: ['D:\\b'] } }))
    expect(await api.create({ title: 'x', roots: ['D:\\b'] })).toEqual({ id: 's2', title: 'x', roots: ['D:\\b'] })
    const [, init] = fetchMock.mock.calls[0]!
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ title: 'x', roots: ['D:\\b'] }))
  })

  it('updates and deletes through the encoded id path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, space: { id: 's1', roots: [] } }))
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    expect(await api.update('s/1', { roots: ['E:\\c'] })).toEqual({ id: 's1', roots: [] })
    await api.remove('s/1')
    expect(fetchMock.mock.calls[0]![0]).toBe('/codex-project/api/spaces/s%2F1')
    expect(fetchMock.mock.calls[1]![0]).toBe('/codex-project/api/spaces/s%2F1')
    expect(fetchMock.mock.calls[1]![1]?.method).toBe('DELETE')
  })

  it('surfaces the server error message with the status', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { ok: false, error: 'space root is not an existing directory: X' }))
    await expect(api.create({ roots: ['X'] })).rejects.toMatchObject({
      name: 'SpacesApiError',
      status: 400,
      message: 'space root is not an existing directory: X',
    })
  })

  it('wraps network failures', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    await expect(api.list()).rejects.toBeInstanceOf(SpacesApiError)
    await expect(api.list()).rejects.toMatchObject({ status: 0 })
  })
})
