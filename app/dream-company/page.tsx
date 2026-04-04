'use client'

import { useState, useRef, useCallback } from 'react'
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle, Star, TrendingUp, Briefcase, MapPin, ChevronRight, Target } from 'lucide-react'
import { Navigation } from '@/components/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { useDreamCompany, STEP_LABELS } from '@/lib/dream-company'
import type { DreamCompanyInput, DreamCompanyResult, Company } from '@/types/dream-company'
import type { ViewName } from '@/shared/types/navigation'

const EMPTY_FORM: DreamCompanyInput = {
  degree: '',
  workExperience: '',
  skills: '',
  interests: '',
  targetSalary: '',
  location: '',
}

const MARKET_LEVEL_COLORS: Record<string, string> = {
  entry: 'bg-gray-100 text-gray-800',
  junior: 'bg-blue-100 text-blue-800',
  mid: 'bg-green-100 text-green-800',
  senior: 'bg-purple-100 text-purple-800',
  lead: 'bg-orange-100 text-orange-800',
  executive: 'bg-yellow-100 text-yellow-900',
}

const URGENCY_COLORS: Record<string, string> = {
  high: 'text-red-600 bg-red-50 border-red-200',
  medium: 'text-amber-600 bg-amber-50 border-amber-200',
  low: 'text-blue-600 bg-blue-50 border-blue-200',
}

const DEMAND_COLORS: Record<string, string> = {
  high: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-gray-100 text-gray-800',
}

export default function DreamCompanyPage() {
  const [inputMode, setInputMode] = useState<'upload' | 'manual'>('manual')
  const [form, setForm] = useState<DreamCompanyInput>(EMPTY_FORM)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const [cvParsing, setCvParsing] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { result, loading, error, currentStep, generateFromProfile, uploadCV, reset } = useDreamCompany()

  const updateField = useCallback((field: keyof DreamCompanyInput, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }, [])

  const handleNavigate = useCallback((view: ViewName) => {
    window.location.href = '/'
  }, [])

  const handleFileSelect = useCallback(async (file: File) => {
    const ext = file.name.toLowerCase()
    if (!ext.endsWith('.pdf') && !ext.endsWith('.docx')) {
      return
    }

    setUploadedFileName(file.name)
    setCvParsing(true)

    const parsed = await uploadCV(file)
    setCvParsing(false)

    if (parsed) {
      setForm(parsed)
      setInputMode('manual')
    }
  }, [uploadCV])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }, [handleFileSelect])

  const handleSubmit = useCallback(() => {
    generateFromProfile(form)
  }, [form, generateFromProfile])

  const handleReset = useCallback(() => {
    reset()
    setForm(EMPTY_FORM)
    setUploadedFileName(null)
    setInputMode('manual')
  }, [reset])

  const canSubmit = form.degree && form.workExperience && form.skills && form.location

  return (
    <div className="min-h-screen bg-white">
      <Navigation currentView="companies" onNavigate={handleNavigate} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8">
          <h1 className="text-4xl font-serif font-bold text-blue-900 mb-3">Dream Company Finder</h1>
          <p className="text-lg text-gray-600">
            Input your career profile and discover your ideal companies, roles, and career roadmap.
          </p>
        </div>

        <div className={`grid gap-8 ${result ? 'lg:grid-cols-[400px_1fr]' : 'max-w-2xl'}`}>
          {/* LEFT PANEL — Input Form */}
          <div className="space-y-6">
            {/* Mode Toggle */}
            <div className="flex gap-2">
              <Button
                variant={inputMode === 'upload' ? 'default' : 'outline'}
                onClick={() => setInputMode('upload')}
                className="flex-1"
              >
                <Upload className="w-4 h-4 mr-2" />
                Upload CV
              </Button>
              <Button
                variant={inputMode === 'manual' ? 'default' : 'outline'}
                onClick={() => setInputMode('manual')}
                className="flex-1"
              >
                <FileText className="w-4 h-4 mr-2" />
                Fill Manually
              </Button>
            </div>

            {/* Upload CV Mode */}
            {inputMode === 'upload' && (
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
                onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true) }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
                  isDragOver
                    ? 'border-yellow-500 bg-yellow-50'
                    : 'border-gray-300 hover:border-gray-400 bg-gray-50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleFileSelect(file)
                  }}
                />
                {cvParsing ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-10 h-10 text-yellow-500 animate-spin" />
                    <p className="text-sm text-gray-600">Parsing {uploadedFileName}...</p>
                  </div>
                ) : uploadedFileName ? (
                  <div className="flex flex-col items-center gap-3">
                    <CheckCircle2 className="w-10 h-10 text-green-500" />
                    <p className="text-sm font-medium text-gray-900">{uploadedFileName}</p>
                    <p className="text-xs text-gray-500">Click or drop to replace</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <Upload className="w-10 h-10 text-gray-400" />
                    <p className="text-sm font-medium text-gray-700">
                      Drag & drop your CV here, or click to browse
                    </p>
                    <p className="text-xs text-gray-500">Supports PDF and DOCX</p>
                  </div>
                )}
              </div>
            )}

            {/* Manual Form */}
            {inputMode === 'manual' && (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="degree">Degree *</Label>
                  <Input
                    id="degree"
                    placeholder="e.g., Bachelor of Computer Science"
                    value={form.degree}
                    onChange={(e) => updateField('degree', e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="workExperience">Work Experience *</Label>
                  <Textarea
                    id="workExperience"
                    placeholder="Describe your work experience, roles, and key achievements..."
                    rows={4}
                    value={form.workExperience}
                    onChange={(e) => updateField('workExperience', e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="skills">Skills *</Label>
                  <Input
                    id="skills"
                    placeholder="e.g., React, TypeScript, Node.js, Python, Leadership"
                    value={form.skills}
                    onChange={(e) => updateField('skills', e.target.value)}
                  />
                  <p className="text-xs text-gray-500 mt-1">Separate skills with commas</p>
                </div>

                <div>
                  <Label htmlFor="interests">Interests</Label>
                  <Input
                    id="interests"
                    placeholder="e.g., AI/ML, FinTech, Healthcare, Sustainability"
                    value={form.interests}
                    onChange={(e) => updateField('interests', e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="targetSalary">Target Salary</Label>
                  <Input
                    id="targetSalary"
                    placeholder="e.g., $120,000 - $150,000"
                    value={form.targetSalary}
                    onChange={(e) => updateField('targetSalary', e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="location">Location *</Label>
                  <Input
                    id="location"
                    placeholder="e.g., San Francisco, CA"
                    value={form.location}
                    onChange={(e) => updateField('location', e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Error Display */}
            {error && (
              <div className="flex items-start gap-3 p-4 rounded-lg bg-red-50 border border-red-200">
                <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* Submit / Loading / Reset */}
            {result ? (
              <Button onClick={handleReset} variant="outline" className="w-full">
                Start New Search
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                disabled={!canSubmit || loading}
                className="w-full bg-yellow-500 hover:bg-yellow-400 text-blue-900 font-semibold h-12 text-base"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {STEP_LABELS[currentStep]}
                  </span>
                ) : (
                  'Find My Dream Companies'
                )}
              </Button>
            )}

            {/* Step Progress */}
            {loading && (
              <div className="space-y-3">
                <StepIndicator step="analyzing" current={currentStep} label="Analyzing profile" />
                <StepIndicator step="building-matrix" current={currentStep} label="Building company matrix" />
                <StepIndicator step="finding-roles" current={currentStep} label="Finding target roles" />
                <StepIndicator step="building-roadmap" current={currentStep} label="Building career roadmap" />
              </div>
            )}
          </div>

          {/* RIGHT PANEL — Results */}
          {result && <ResultsPanel result={result} />}
        </div>
      </div>
    </div>
  )
}

// ─── Step Indicator ──────────────────────────────────────────

function StepIndicator({ step, current, label }: {
  step: string
  current: string
  label: string
}) {
  const steps = ['analyzing', 'building-matrix', 'finding-roles', 'building-roadmap']
  const stepIdx = steps.indexOf(step)
  const currentIdx = steps.indexOf(current)
  const isComplete = currentIdx > stepIdx
  const isActive = current === step

  return (
    <div className="flex items-center gap-3">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${
        isComplete ? 'bg-green-500 text-white' :
        isActive ? 'bg-yellow-500 text-blue-900' :
        'bg-gray-200 text-gray-500'
      }`}>
        {isComplete ? <CheckCircle2 className="w-4 h-4" /> : stepIdx + 1}
      </div>
      <span className={`text-sm ${
        isActive ? 'text-blue-900 font-medium' :
        isComplete ? 'text-green-700' :
        'text-gray-400'
      }`}>
        {label}
        {isActive && <Loader2 className="w-3 h-3 inline ml-2 animate-spin" />}
      </span>
    </div>
  )
}

// ─── Results Panel ───────────────────────────────────────────

function ResultsPanel({ result }: { result: DreamCompanyResult }) {
  return (
    <Tabs defaultValue="analysis" className="min-w-0">
      <TabsList className="w-full grid grid-cols-4">
        <TabsTrigger value="analysis">Profile</TabsTrigger>
        <TabsTrigger value="matrix">Companies</TabsTrigger>
        <TabsTrigger value="roles">Roles</TabsTrigger>
        <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
      </TabsList>

      <TabsContent value="analysis">
        <ProfileAnalysisTab analysis={result.analysis} />
      </TabsContent>
      <TabsContent value="matrix">
        <CompanyMatrixTab matrix={result.matrix} />
      </TabsContent>
      <TabsContent value="roles">
        <TargetRolesTab roles={result.roles} />
      </TabsContent>
      <TabsContent value="roadmap">
        <CareerRoadmapTab roadmap={result.roadmap} />
      </TabsContent>
    </Tabs>
  )
}

// ─── Profile Analysis Tab ────────────────────────────────────

function ProfileAnalysisTab({ analysis }: { analysis: DreamCompanyResult['analysis'] }) {
  return (
    <div className="space-y-6 mt-4">
      {/* Header Row */}
      <div className="flex flex-wrap items-center gap-4">
        <Badge className={MARKET_LEVEL_COLORS[analysis.marketLevel] || 'bg-gray-100 text-gray-800'}>
          {analysis.marketLevel.toUpperCase()}
        </Badge>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>{analysis.salaryRange.currency} {analysis.salaryRange.min.toLocaleString()} - {analysis.salaryRange.max.toLocaleString()}</span>
        </div>
      </div>

      {/* Readiness Score */}
      <div className="flex items-center gap-6">
        <ReadinessRing score={analysis.readinessScore} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">Readiness Score</p>
          <p className="text-sm text-gray-600 mt-1">{analysis.readinessNote}</p>
        </div>
      </div>

      {/* Unique Value Proposition */}
      <div className="border-l-4 border-yellow-500 bg-yellow-50 rounded-r-lg p-4">
        <p className="text-sm font-medium text-gray-900 mb-1">Unique Value Proposition</p>
        <p className="text-sm text-gray-700 italic">{analysis.uniqueValueProposition}</p>
      </div>

      {/* Market Level Rationale */}
      <div>
        <p className="text-sm font-medium text-gray-900 mb-1">Market Level Rationale</p>
        <p className="text-sm text-gray-600">{analysis.marketLevelRationale}</p>
      </div>

      {/* Strengths */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Core Strengths</h3>
        <div className="space-y-3">
          {analysis.coreStrengths.map((s, i) => (
            <div key={i} className="flex gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-900">{s.strength}</p>
                <p className="text-xs text-gray-500">{s.evidence}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Gaps */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Critical Gaps</h3>
        <div className="space-y-3">
          {analysis.criticalGaps.map((g, i) => (
            <div key={i} className={`flex gap-3 p-3 rounded-lg border ${URGENCY_COLORS[g.urgency]}`}>
              <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{g.gap}</p>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {g.urgency}
                  </Badge>
                </div>
                <p className="text-xs mt-1 opacity-80">{g.impact}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Readiness Ring ──────────────────────────────────────────

function ReadinessRing({ score }: { score: number }) {
  const radius = 36
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference

  const color = score >= 75 ? '#22c55e' : score >= 50 ? '#eab308' : '#ef4444'

  return (
    <div className="relative w-24 h-24 shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="6" />
        <circle
          cx="40" cy="40" r={radius} fill="none"
          stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-1000"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xl font-bold text-gray-900">{score}</span>
      </div>
    </div>
  )
}

// ─── Company Matrix Tab ──────────────────────────────────────

function CompanyMatrixTab({ matrix }: { matrix: DreamCompanyResult['matrix'] }) {
  return (
    <div className="space-y-8 mt-4">
      <TierSection
        tier={1}
        label={matrix.tier1.label}
        description={matrix.tier1.description}
        companies={matrix.tier1.companies}
      />
      <TierSection
        tier={2}
        label={matrix.tier2.label}
        description={matrix.tier2.description}
        companies={matrix.tier2.companies}
      />
      <TierSection
        tier={3}
        label={matrix.tier3.label}
        description={matrix.tier3.description}
        companies={matrix.tier3.companies}
      />
    </div>
  )
}

function TierSection({ tier, label, description, companies }: {
  tier: 1 | 2 | 3
  label: string
  description: string
  companies: Company[]
}) {
  const tierStyles = {
    1: 'border-l-4 border-yellow-500',
    2: 'border-l-4 border-blue-500',
    3: 'border-l-4 border-gray-400',
  }

  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          {tier === 1 && <Star className="w-5 h-5 text-yellow-500" />}
          <h3 className="text-lg font-semibold text-blue-900">{label}</h3>
          <Badge variant={tier === 1 ? 'default' : 'outline'} className={tier === 1 ? 'bg-yellow-500 text-blue-900' : ''}>
            Tier {tier}
          </Badge>
        </div>
        <p className="text-sm text-gray-600">{description}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {companies.map((company, i) => (
          <Card key={i} className={`${tierStyles[tier]} ${tier === 1 ? 'shadow-md' : ''}`}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base">{company.name}</CardTitle>
                  <CardDescription>{company.industry}</CardDescription>
                </div>
                <Briefcase className="w-4 h-4 text-gray-400 shrink-0" />
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <span className="font-medium text-gray-700">Likely Role: </span>
                <span className="text-gray-600">{company.likelyRole}</span>
              </div>
              <div>
                <span className="font-medium text-gray-700">Why: </span>
                <span className="text-gray-600">{company.why}</span>
              </div>
              <div>
                <span className="font-medium text-gray-700">Challenge: </span>
                <span className="text-gray-600">{company.challenge}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ─── Target Roles Tab ────────────────────────────────────────

function TargetRolesTab({ roles }: { roles: DreamCompanyResult['roles'] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 mt-4">
      {roles.map((role, i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-base">{role.title}</CardTitle>
              <Badge variant="outline">{role.level}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-700">Fit Score</span>
                <span className="text-xs font-bold text-blue-900">{role.fitScore}%</span>
              </div>
              <Progress value={role.fitScore} className="h-2" />
            </div>
            <p className="text-sm text-gray-600">{role.fitReason}</p>
            <div className="flex items-center justify-between">
              <Badge className={DEMAND_COLORS[role.demandLevel]}>
                {role.demandLevel} demand
              </Badge>
              <span className="text-sm font-medium text-gray-900">{role.avgSalary}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ─── Career Roadmap Tab ──────────────────────────────────────

function CareerRoadmapTab({ roadmap }: { roadmap: DreamCompanyResult['roadmap'] }) {
  return (
    <div className="relative mt-4">
      {/* Timeline line */}
      <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-gray-200" />

      <div className="space-y-8">
        {roadmap.phases.map((phase, i) => (
          <div key={i} className="relative pl-14">
            {/* Timeline node */}
            <div className="absolute left-2.5 w-5 h-5 rounded-full bg-blue-900 border-4 border-white shadow" />

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3 mb-1">
                  <Badge className="bg-blue-900 text-white">Phase {phase.phase}</Badge>
                  <span className="text-sm text-gray-500">{phase.duration}</span>
                </div>
                <CardTitle className="text-lg">{phase.goal}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Actions */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Actions</p>
                  <ul className="space-y-2">
                    {phase.actions.map((action, j) => (
                      <li key={j} className="flex items-start gap-2 text-sm text-gray-700">
                        <ChevronRight className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
                        {action}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Skills */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Skills to Build</p>
                  <div className="flex flex-wrap gap-2">
                    {phase.skills.map((skill, j) => (
                      <Badge key={j} variant="secondary">{skill}</Badge>
                    ))}
                  </div>
                </div>

                {/* Milestone */}
                <div className="flex items-start gap-2 p-3 rounded-lg bg-green-50 border border-green-200">
                  <Target className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-green-800">Milestone</p>
                    <p className="text-sm text-green-700">{phase.milestone}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>
    </div>
  )
}
