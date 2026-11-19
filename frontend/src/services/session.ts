/** Account sessions persist only when the pilot explicitly opts in. */
export const TOKEN_KEY = 'orbital-outlaws.account.session.v1'
export const ACCOUNT_KEY = 'orbital-outlaws.account.id.v1'

export function restoreSession(): string {
  let token = sessionStorage.getItem(TOKEN_KEY)
  if (!token) {
    token = localStorage.getItem(TOKEN_KEY)
    const id = localStorage.getItem(ACCOUNT_KEY)
    if (token && id) {
      sessionStorage.setItem(TOKEN_KEY, token)
      sessionStorage.setItem(ACCOUNT_KEY, id)
    } else token = null
  }
  return token || ''
}

export function accountId(): string {
  restoreSession()
  return sessionStorage.getItem(ACCOUNT_KEY) || ''
}

export function saveSession(token: string, id: string, remember: boolean): void {
  sessionStorage.setItem(TOKEN_KEY, token)
  sessionStorage.setItem(ACCOUNT_KEY, id)
  if (remember) {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(ACCOUNT_KEY, id)
  } else {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(ACCOUNT_KEY)
  }
}

export function clearSession(): void {
  for (const key of [TOKEN_KEY, ACCOUNT_KEY]) {
    sessionStorage.removeItem(key)
    localStorage.removeItem(key)
  }
}
