type StoredCsrf = {
  token: string
  headerName: string
}

let current: StoredCsrf | null = null

export const csrfStore = {
  get: (): StoredCsrf | null => current,
  set: (csrf: StoredCsrf): void => {
    current = csrf
  },
  clear: (): void => {
    current = null
  },
}
