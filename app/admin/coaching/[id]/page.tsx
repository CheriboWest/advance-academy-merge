import { CoachConsole } from '@/features/coaching/components/coach-console'

// One session's battlecard (ticket T5).
export default async function AdminCoachingSessionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <CoachConsole sessionId={id} />
}
