import axios from 'axios'
import type { ApiErrorBody, FieldError } from './types'

const fallbackBody: ApiErrorBody = {
  timestamp: '',
  status: 0,
  code: 'NETWORK_ERROR',
  message: 'Unable to reach the server. Please try again.',
  path: '',
  fieldErrors: [],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseFieldErrors(value: unknown): FieldError[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.field !== 'string' || typeof entry.message !== 'string') return []
    return [{ field: entry.field, message: entry.message }]
  })
}

function parseBody(value: unknown, fallbackStatus = 0): ApiErrorBody {
  if (!isRecord(value)) return { ...fallbackBody, status: fallbackStatus }
  return {
    timestamp: typeof value.timestamp === 'string' ? value.timestamp : '',
    status: typeof value.status === 'number' ? value.status : fallbackStatus,
    code: typeof value.code === 'string' ? value.code : 'INTERNAL_ERROR',
    message: typeof value.message === 'string' ? value.message : 'Something went wrong. Please try again.',
    path: typeof value.path === 'string' ? value.path : '',
    fieldErrors: parseFieldErrors(value.fieldErrors),
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly path: string
  readonly fieldErrors: FieldError[]

  constructor(body: ApiErrorBody) {
    super(body.message)
    this.name = 'ApiError'
    this.status = body.status
    this.code = body.code
    this.path = body.path
    this.fieldErrors = body.fieldErrors
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (axios.isAxiosError(error)) {
    return new ApiError(parseBody(error.response?.data, error.response?.status))
  }
  return new ApiError({ ...fallbackBody, message: error instanceof Error ? error.message : fallbackBody.message })
}

export function applyFieldErrors<TFieldName extends string>(
  error: ApiError,
  setError: (field: TFieldName, error: { type: string; message: string }) => void,
  validFields: readonly TFieldName[],
): void {
  const fieldSet = new Set<string>(validFields)
  for (const fieldError of error.fieldErrors) {
    const simpleField = fieldError.field.replace(/^request\./, '')
    if (fieldSet.has(simpleField)) {
      setError(simpleField as TFieldName, { type: 'server', message: fieldError.message })
    }
  }
}
