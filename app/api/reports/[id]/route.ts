import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { loadProfile } from '@/lib/profile'
import { buildSpec } from '@/lib/tools/visualization'

const REPORTS_PATH = path.join(process.cwd(), 'reports.json')

function load(): Record<string, unknown>[] {
  if (!fs.existsSync(REPORTS_PATH)) return []
  return JSON.parse(fs.readFileSync(REPORTS_PATH, 'utf-8'))
}

function save(reports: Record<string, unknown>[]) {
  fs.writeFileSync(REPORTS_PATH, JSON.stringify(reports, null, 2))
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const reports = load()
  const filtered = reports.filter(r => r.id !== id)
  if (filtered.length === reports.length) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  save(filtered.map((r, i) => ({ ...r, position: i })))
  return NextResponse.json({ status: 'deleted', id })
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const reports = load()
  const item = reports.find(r => r.id === id) as { chart_type: string; title: string } | undefined
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const profile = loadProfile()
  const spec = buildSpec(item.chart_type, item.title, profile)
  return NextResponse.json(spec)
}
