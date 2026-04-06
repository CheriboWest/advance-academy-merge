import { Suspense } from 'react'
import { HomePageContent } from '@/app/home-page-content'

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomePageContent />
    </Suspense>
  )
}
