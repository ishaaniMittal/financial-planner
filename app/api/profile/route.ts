import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const PROFILE_PATH = path.join(process.cwd(), 'profile.json')

export async function GET() {
  if (!fs.existsSync(PROFILE_PATH)) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }
  const data = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf-8'))
  return NextResponse.json(data)
}

export async function PUT(req: Request) {
  const updates = await req.json()
  const existing = fs.existsSync(PROFILE_PATH)
    ? JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf-8'))
    : {}
  const merged = { ...existing, ...updates }
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(merged, null, 2))
  return NextResponse.json({ status: 'updated' })
}
