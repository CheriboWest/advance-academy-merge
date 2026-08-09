import { CoachQueue } from '@/features/coaching/components/coach-queue'

// The coach's queue and calendar (ticket T2.5). The /admin shell lives in
// ../layout.tsx; admin rights are enforced by the API this page calls.
export default function AdminCoachingPage() {
  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Coaching</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every booked session, ordered by how soon the student&rsquo;s real interview is —
          not by when they booked. Open one to review its pack, edit the questions and
          approve it. Nothing reaches the student until you do.
        </p>
      </header>
      <CoachQueue />
    </>
  )
}
