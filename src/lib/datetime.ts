function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function nowDateStr(): string {
  const d = new Date()
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
}

export function nowTimeStr(): string {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function isoToDateStr(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
}

export function isoToTimeStr(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function parseDateTimeToISO(date: string, time: string): string {
  const parts = date.split('.')
  if (parts.length !== 3) return new Date().toISOString()
  const [day, month, year] = parts
  const t = time || '00:00'
  const parsed = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${t}:00`)
  return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}
