import { loadProfile } from '@/lib/profile'
import { deriveProfile } from '@/lib/profile-derived'
import { MeridianShell } from '@/components/MeridianShell'

export default function Home() {
  const profile = loadProfile()
  const derived = deriveProfile(profile)
  return <MeridianShell derived={derived} />
}
