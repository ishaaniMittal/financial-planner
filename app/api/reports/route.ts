import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

const REPORTS_PATH = path.join(process.cwd(), 'reports.json')

function load(): Record<string, unknown>[] {
  if (!fs.existsSync(REPORTS_PATH)) return []
  return JSON.parse(fs.readFileSync(REPORTS_PATH, 'utf-8'))
}

function save(reports: Record<string, unknown>[]) {
  fs.writeFileSync(REPORTS_PATH, JSON.stringify(reports, null, 2))
}

export async function GET() {
  return NextResponse.json(load())
}

export async function POST(req: Request) {
  const { chart_type, title, description = '' } = await req.json()
  const reports = load()
  const item = {
    id: uuidv4().slice(0, 8),
    chart_type, title, description,
    created_at: new Date().toISOString(),
    position: reports.length,
  }
  reports.push(item)
  save(reports)
  return NextResponse.json(item)
}
