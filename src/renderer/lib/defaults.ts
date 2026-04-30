import type { ConnectionConfig } from '@shared/types'

export function defaultConnection(role: 'live' | 'backup'): ConnectionConfig {
  return {
    role,
    server: '',
    port: 1433,
    database: '',
    authentication: 'sql',
    username: '',
    password: '',
    encrypt: true,
    trustServerCertificate: false
  }
}
