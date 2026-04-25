import { Target } from 'lucide-react'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-blue-900 flex flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 flex items-center gap-3">
        <div className="w-10 h-10 bg-yellow-500 rounded-full flex items-center justify-center">
          <Target className="w-6 h-6 text-blue-900" />
        </div>
        <span className="text-2xl font-serif font-semibold text-white">Advance Academy</span>
      </div>
      {children}
    </div>
  )
}
