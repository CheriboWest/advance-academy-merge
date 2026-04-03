'use client'

import { useState, useMemo } from 'react'
import { Menu, X, ChevronRight, Upload, Loader, CheckCircle2, AlertCircle, FileText, Briefcase, Brain, Target } from 'lucide-react'

export default function Home() {
  const [currentView, setCurrentView] = useState('home')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Dream Company Finder State
  const [companyStep, setCompanyStep] = useState(1)
  const [companyForm, setCompanyForm] = useState({
    industry: '',
    location: '',
    companySize: ''
  })
  const [companyResults, setCompanyResults] = useState(null)
  const [companyLoading, setCompanyLoading] = useState(false)

  // Recruitment Outreach State
  const [outreachForm, setOutreachForm] = useState({
    jobTitle: '',
    company: ''
  })
  const [outreachResults, setOutreachResults] = useState(null)
  const [outreachLoading, setOutreachLoading] = useState(false)

  // CV Optimizer State
  const [cvTab, setCvTab] = useState('analysis')
  const [cvLoading, setCvLoading] = useState(false)
  const [cvResults, setCvResults] = useState(null)

  // Mock Data Functions
  const mockCompanies = [
    { name: 'TechFlow Systems', industry: 'Software', location: 'San Francisco, CA', match: 94 },
    { name: 'DataMind Analytics', industry: 'Data Science', location: 'New York, NY', match: 91 },
    { name: 'CloudVenture Inc', industry: 'Cloud Computing', location: 'Seattle, WA', match: 88 },
  ]

  const mockScripts = [
    {
      type: 'LinkedIn Message',
      content: 'Hi [Recruiter Name], I noticed your recent post about [specific project]. Your work aligns perfectly with my background in [relevant skill]. I\'d love to discuss potential opportunities at [Company]. Looking forward to connecting!'
    },
    {
      type: 'Email Outreach',
      content: 'Subject: Excited to discuss [role] at [Company]\n\nDear [Hiring Manager],\n\nI\'ve followed [Company]\'s impressive growth in [industry]. With [X years] experience in [skill set], I\'m excited about the opportunity to contribute to your team. Let\'s schedule a brief call?\n\nBest regards,\n[Your Name]'
    },
    {
      type: 'Phone Script',
      content: 'Hi [Name], I hope I\'m not catching you at a bad time. I\'m calling because I\'m very interested in [specific role] at [Company]. I\'ve admired your work in [industry], and I believe my background in [skill] could be valuable. Would you have 15 minutes next week to discuss?'
    }
  ]

  const mockCVReview = {
    overallScore: 78,
    sections: [
      { title: 'Technical Skills', score: 85, feedback: 'Strong technical keywords. Consider adding more specific technologies and certifications.' },
      { title: 'Experience', score: 75, feedback: 'Good structure. Add more quantifiable results (e.g., "increased revenue by 40%").' },
      { title: 'Education', score: 74, feedback: 'Complete but could highlight relevant certifications and relevant coursework.' }
    ],
    expertReview: 'Your CV has solid foundations. Focus on adding metrics and quantifiable impact to each role. Also consider tailoring it for specific job descriptions you apply to. Using more action verbs will strengthen your impact statements.'
  }

  // Event Handlers
  const handleCompanySearch = async () => {
    if (companyForm.industry && companyForm.location && companyForm.companySize) {
      setCompanyLoading(true)
      setTimeout(() => {
        setCompanyResults(mockCompanies)
        setCompanyLoading(false)
      }, 2500)
    }
  }

  const handleOutreachGenerate = async () => {
    if (outreachForm.jobTitle && outreachForm.company) {
      setOutreachLoading(true)
      setTimeout(() => {
        setOutreachResults(mockScripts)
        setOutreachLoading(false)
      }, 2500)
    }
  }

  const handleCVUpload = async () => {
    setCvLoading(true)
    setTimeout(() => {
      setCvResults(mockCVReview)
      setCvLoading(false)
    }, 2500)
  }

  const resetStates = () => {
    setCompanyStep(1)
    setCompanyResults(null)
    setOutreachResults(null)
    setCvResults(null)
    setCvTab('analysis')
  }

  // Navigation
  const navItems = [
    { label: 'Home', view: 'home' },
    { label: 'Dream Company', view: 'companies' },
    { label: 'Outreach', view: 'outreach' },
    { label: 'CV Optimizer', view: 'cv' },
    { label: 'Interview Prep', view: 'interview' },
  ]

  const renderNavigation = () => (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-900 rounded-full flex items-center justify-center">
              <Target className="w-5 h-5 text-yellow-500" />
            </div>
            <span className="text-xl font-serif font-semibold text-blue-900">Advance Academy</span>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <button
                key={item.view}
                onClick={() => {
                  setCurrentView(item.view)
                  resetStates()
                }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  currentView === item.view
                    ? 'bg-yellow-500 text-blue-900'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Mobile Menu Toggle */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 hover:bg-gray-100 rounded-lg"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden pb-4 flex flex-col gap-2">
            {navItems.map((item) => (
              <button
                key={item.view}
                onClick={() => {
                  setCurrentView(item.view)
                  resetStates()
                  setMobileMenuOpen(false)
                }}
                className={`w-full text-left px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  currentView === item.view
                    ? 'bg-yellow-500 text-blue-900'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </nav>
  )

  // Ornamental Divider Component
  const Divider = () => (
    <div className="flex items-center justify-center gap-4 my-12">
      <div className="flex-1 h-px bg-yellow-500 opacity-30"></div>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="8" stroke="#D4AF37" strokeWidth="1.5" fill="none" />
        <circle cx="12" cy="12" r="4" fill="#D4AF37" />
      </svg>
      <div className="flex-1 h-px bg-yellow-500 opacity-30"></div>
    </div>
  )

  // Home View
  if (currentView === 'home') {
    return (
      <div className="min-h-screen bg-white">
        {renderNavigation()}
        
        {/* Hero */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
          <div className="text-center mb-16">
            <h1 className="text-5xl md:text-6xl font-serif font-bold text-blue-900 mb-6 text-balance">
              Accelerate Your Career
            </h1>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto text-balance">
              Powered by AI-driven tools designed to help you land your dream job. From discovering perfect companies to mastering interviews.
            </p>
          </div>

          <Divider />

          {/* Feature Cards */}
          <div className="grid md:grid-cols-2 gap-8 mb-16">
            {/* Dream Company Finder */}
            <div className="bg-gray-50 rounded-xl p-8 hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setCurrentView('companies')}>
              <div className="w-12 h-12 bg-yellow-500 rounded-lg flex items-center justify-center mb-4">
                <Briefcase className="w-6 h-6 text-blue-900" />
              </div>
              <h3 className="text-2xl font-serif font-semibold text-blue-900 mb-3">Dream Company Finder</h3>
              <p className="text-gray-600 mb-4">Discover companies that match your career goals, industry preferences, and location requirements.</p>
              <div className="flex items-center gap-2 text-yellow-600 font-medium">
                Explore <ChevronRight className="w-4 h-4" />
              </div>
            </div>

            {/* Recruitment Outreach */}
            <div className="bg-gray-50 rounded-xl p-8 hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setCurrentView('outreach')}>
              <div className="w-12 h-12 bg-yellow-500 rounded-lg flex items-center justify-center mb-4">
                <Target className="w-6 h-6 text-blue-900" />
              </div>
              <h3 className="text-2xl font-serif font-semibold text-blue-900 mb-3">Recruitment Outreach</h3>
              <p className="text-gray-600 mb-4">Generate personalized outreach scripts for LinkedIn, email, and phone conversations with recruiters.</p>
              <div className="flex items-center gap-2 text-yellow-600 font-medium">
                Generate <ChevronRight className="w-4 h-4" />
              </div>
            </div>

            {/* CV Optimizer */}
            <div className="bg-gray-50 rounded-xl p-8 hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setCurrentView('cv')}>
              <div className="w-12 h-12 bg-yellow-500 rounded-lg flex items-center justify-center mb-4">
                <FileText className="w-6 h-6 text-blue-900" />
              </div>
              <h3 className="text-2xl font-serif font-semibold text-blue-900 mb-3">CV Optimizer</h3>
              <p className="text-gray-600 mb-4">Get AI-powered analysis of your CV with expert feedback on structure, content, and impact.</p>
              <div className="flex items-center gap-2 text-yellow-600 font-medium">
                Optimize <ChevronRight className="w-4 h-4" />
              </div>
            </div>

            {/* Interview Prep */}
            <div className="bg-gray-50 rounded-xl p-8 hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setCurrentView('interview')}>
              <div className="w-12 h-12 bg-yellow-500 rounded-lg flex items-center justify-center mb-4">
                <Brain className="w-6 h-6 text-blue-900" />
              </div>
              <h3 className="text-2xl font-serif font-semibold text-blue-900 mb-3">Interview Prep</h3>
              <p className="text-gray-600 mb-4">Master behavioral questions, technical interviews, and company-specific preparation strategies.</p>
              <div className="flex items-center gap-2 text-yellow-600 font-medium">
                Prepare <ChevronRight className="w-4 h-4" />
              </div>
            </div>
          </div>

          <Divider />

          {/* CTA Section */}
          <div className="bg-gradient-to-r from-blue-900 to-blue-800 rounded-xl p-12 text-center text-white">
            <h2 className="text-3xl font-serif font-bold mb-4">Ready to advance your career?</h2>
            <p className="text-lg opacity-90 mb-6">Start with finding your dream company or optimizing your CV.</p>
            <div className="flex gap-4 justify-center flex-wrap">
              <button
                onClick={() => setCurrentView('companies')}
                className="px-6 py-3 bg-yellow-500 text-blue-900 rounded-lg font-semibold hover:bg-yellow-400 transition-colors"
              >
                Find Dream Companies
              </button>
              <button
                onClick={() => setCurrentView('cv')}
                className="px-6 py-3 bg-white/20 hover:bg-white/30 rounded-lg font-semibold transition-colors"
              >
                Optimize Your CV
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="bg-blue-900 text-white mt-16 py-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <p className="text-sm opacity-75">© 2024 Advance Academy. Your path to career success.</p>
          </div>
        </footer>
      </div>
    )
  }

  // Dream Company Finder View
  if (currentView === 'companies') {
    return (
      <div className="min-h-screen bg-white">
        {renderNavigation()}
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <h1 className="text-4xl font-serif font-bold text-blue-900 mb-4">Dream Company Finder</h1>
          <p className="text-gray-600 text-lg mb-12">Find companies that align with your career aspirations.</p>

          {!companyResults ? (
            <div className="bg-gray-50 rounded-xl p-8">
              <div className="max-w-2xl">
                {/* Step Indicator */}
                <div className="flex gap-2 mb-8">
                  {[1, 2, 3].map((step) => (
                    <div
                      key={step}
                      className={`h-2 flex-1 rounded-full transition-colors ${
                        step <= companyStep ? 'bg-yellow-500' : 'bg-gray-300'
                      }`}
                    ></div>
                  ))}
                </div>

                {/* Step 1: Industry */}
                {companyStep === 1 && (
                  <div>
                    <label className="block text-sm font-semibold text-blue-900 mb-4">
                      What industry interests you?
                    </label>
                    <select
                      value={companyForm.industry}
                      onChange={(e) => setCompanyForm({ ...companyForm, industry: e.target.value })}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-yellow-500 bg-white"
                    >
                      <option value="">Select an industry</option>
                      <option value="Tech">Technology</option>
                      <option value="Finance">Finance</option>
                      <option value="Healthcare">Healthcare</option>
                      <option value="Education">Education</option>
                      <option value="Consulting">Consulting</option>
                    </select>
                    <button
                      onClick={() => companyForm.industry && setCompanyStep(2)}
                      className="mt-6 w-full px-6 py-3 bg-yellow-500 text-blue-900 rounded-lg font-semibold hover:bg-yellow-400 transition-colors disabled:opacity-50"
                      disabled={!companyForm.industry}
                    >
                      Next
                    </button>
                  </div>
                )}

                {/* Step 2: Location */}
                {companyStep === 2 && (
                  <div>
                    <label className="block text-sm font-semibold text-blue-900 mb-4">
                      Preferred location?
                    </label>
                    <select
                      value={companyForm.location}
                      onChange={(e) => setCompanyForm({ ...companyForm, location: e.target.value })}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-yellow-500 bg-white"
                    >
                      <option value="">Select a location</option>
                      <option value="San Francisco">San Francisco, CA</option>
                      <option value="New York">New York, NY</option>
                      <option value="Seattle">Seattle, WA</option>
                      <option value="Austin">Austin, TX</option>
                      <option value="Remote">Remote</option>
                    </select>
                    <div className="flex gap-4 mt-6">
                      <button
                        onClick={() => setCompanyStep(1)}
                        className="flex-1 px-6 py-3 bg-gray-200 text-blue-900 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
                      >
                        Back
                      </button>
                      <button
                        onClick={() => companyForm.location && setCompanyStep(3)}
                        className="flex-1 px-6 py-3 bg-yellow-500 text-blue-900 rounded-lg font-semibold hover:bg-yellow-400 transition-colors disabled:opacity-50"
                        disabled={!companyForm.location}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 3: Company Size */}
                {companyStep === 3 && (
                  <div>
                    <label className="block text-sm font-semibold text-blue-900 mb-4">
                      Company size preference?
                    </label>
                    <select
                      value={companyForm.companySize}
                      onChange={(e) => setCompanyForm({ ...companyForm, companySize: e.target.value })}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-yellow-500 bg-white"
                    >
                      <option value="">Select company size</option>
                      <option value="Startup">Startup (1-50)</option>
                      <option value="Scaleup">Scale-up (50-500)</option>
                      <option value="Mid">Mid-size (500-5000)</option>
                      <option value="Enterprise">Enterprise (5000+)</option>
                    </select>
                    <div className="flex gap-4 mt-6">
                      <button
                        onClick={() => setCompanyStep(2)}
                        className="flex-1 px-6 py-3 bg-gray-200 text-blue-900 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
                      >
                        Back
                      </button>
                      <button
                        onClick={handleCompanySearch}
                        disabled={companyLoading || !companyForm.companySize}
                        className="flex-1 px-6 py-3 bg-yellow-500 text-blue-900 rounded-lg font-semibold hover:bg-yellow-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {companyLoading ? (
                          <>
                            <Loader className="w-4 h-4 animate-spin" /> Finding...
                          </>
                        ) : (
                          'Find Companies'
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-8">
                <button
                  onClick={() => {
                    setCompanyResults(null)
                    setCompanyStep(1)
                  }}
                  className="px-4 py-2 text-yellow-600 font-medium hover:bg-yellow-50 rounded-lg"
                >
                  ← New Search
                </button>
              </div>

              <div className="grid gap-6">
                {companyResults.map((company, idx) => (
                  <div key={idx} className="bg-gray-50 rounded-xl p-8 border-l-4 border-yellow-500">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="text-2xl font-serif font-semibold text-blue-900">{company.name}</h3>
                        <p className="text-gray-600">{company.industry} • {company.location}</p>
                      </div>
                      <div className="text-right">
                        <div className="text-3xl font-bold text-yellow-500">{company.match}%</div>
                        <p className="text-sm text-gray-600">Match Score</p>
                      </div>
                    </div>
                    <div className="flex gap-3 mt-4">
                      <button className="px-4 py-2 bg-yellow-500 text-blue-900 rounded-lg font-medium hover:bg-yellow-400 transition-colors">
                        View Details
                      </button>
                      <button className="px-4 py-2 bg-white border border-yellow-500 text-yellow-600 rounded-lg font-medium hover:bg-yellow-50 transition-colors">
                        Learn More
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Recruitment Outreach View
  if (currentView === 'outreach') {
    return (
      <div className="min-h-screen bg-white">
        {renderNavigation()}
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <h1 className="text-4xl font-serif font-bold text-blue-900 mb-4">Recruitment Outreach Generator</h1>
          <p className="text-gray-600 text-lg mb-12">Generate personalized outreach scripts to connect with recruiters.</p>

          {!outreachResults ? (
            <div className="grid md:grid-cols-2 gap-8">
              {/* Form */}
              <div className="bg-gray-50 rounded-xl p-8">
                <h3 className="text-xl font-serif font-semibold text-blue-900 mb-6">Your Target</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-blue-900 mb-2">Job Title</label>
                    <input
                      type="text"
                      placeholder="e.g., Senior Product Manager"
                      value={outreachForm.jobTitle}
                      onChange={(e) => setOutreachForm({ ...outreachForm, jobTitle: e.target.value })}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-yellow-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-blue-900 mb-2">Company</label>
                    <input
                      type="text"
                      placeholder="e.g., TechFlow Systems"
                      value={outreachForm.company}
                      onChange={(e) => setOutreachForm({ ...outreachForm, company: e.target.value })}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-yellow-500"
                    />
                  </div>
                  <button
                    onClick={handleOutreachGenerate}
                    disabled={outreachLoading || !outreachForm.jobTitle || !outreachForm.company}
                    className="w-full mt-6 px-6 py-3 bg-yellow-500 text-blue-900 rounded-lg font-semibold hover:bg-yellow-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {outreachLoading ? (
                      <>
                        <Loader className="w-4 h-4 animate-spin" /> Generating...
                      </>
                    ) : (
                      'Generate Scripts'
                    )}
                  </button>
                </div>
              </div>

              {/* Info */}
              <div className="bg-blue-50 rounded-xl p-8">
                <h3 className="text-xl font-serif font-semibold text-blue-900 mb-4">Why Outreach?</h3>
                <ul className="space-y-3 text-gray-700">
                  <li className="flex gap-3">
                    <CheckCircle2 className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <span>Direct connections with decision makers</span>
                  </li>
                  <li className="flex gap-3">
                    <CheckCircle2 className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <span>Higher response rates than applications</span>
                  </li>
                  <li className="flex gap-3">
                    <CheckCircle2 className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <span>Personalized approach shows genuine interest</span>
                  </li>
                  <li className="flex gap-3">
                    <CheckCircle2 className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <span>Build relationships before opportunities open</span>
                  </li>
                </ul>
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-8">
                <button
                  onClick={() => setOutreachResults(null)}
                  className="px-4 py-2 text-yellow-600 font-medium hover:bg-yellow-50 rounded-lg"
                >
                  ← Generate New Scripts
                </button>
              </div>

              <div className="space-y-6">
                {outreachResults.map((script, idx) => (
                  <div key={idx} className="bg-gray-50 rounded-xl p-8">
                    <h3 className="text-xl font-serif font-semibold text-blue-900 mb-4">{script.type}</h3>
                    <div className="bg-white rounded-lg p-6 border border-gray-200 mb-4 font-mono text-sm text-gray-700 whitespace-pre-wrap">
                      {script.content}
                    </div>
                    <div className="flex gap-3">
                      <button className="px-4 py-2 bg-yellow-500 text-blue-900 rounded-lg font-medium hover:bg-yellow-400 transition-colors">
                        Copy
                      </button>
                      <button className="px-4 py-2 bg-white border border-yellow-500 text-yellow-600 rounded-lg font-medium hover:bg-yellow-50 transition-colors">
                        Customize
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // CV Optimizer View
  if (currentView === 'cv') {
    return (
      <div className="min-h-screen bg-white">
        {renderNavigation()}
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <h1 className="text-4xl font-serif font-bold text-blue-900 mb-4">CV Optimizer</h1>
          <p className="text-gray-600 text-lg mb-12">Upload your CV for AI-powered analysis and expert feedback.</p>

          {!cvResults ? (
            <div className="grid md:grid-cols-2 gap-8">
              {/* Upload Area */}
              <div className="bg-gray-50 rounded-xl p-8">
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-yellow-500 transition-colors cursor-pointer">
                  <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-700 font-medium mb-2">Drop your CV here</p>
                  <p className="text-gray-500 text-sm mb-4">or click to select a file</p>
                  <p className="text-gray-500 text-xs">PDF, DOCX, or TXT (Max 5MB)</p>
                </div>
                <button
                  onClick={handleCVUpload}
                  disabled={cvLoading}
                  className="w-full mt-6 px-6 py-3 bg-yellow-500 text-blue-900 rounded-lg font-semibold hover:bg-yellow-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {cvLoading ? (
                    <>
                      <Loader className="w-4 h-4 animate-spin" /> Analyzing...
                    </>
                  ) : (
                    'Analyze My CV'
                  )}
                </button>
              </div>

              {/* Tips */}
              <div className="bg-blue-50 rounded-xl p-8">
                <h3 className="text-xl font-serif font-semibold text-blue-900 mb-4">Optimization Tips</h3>
                <ul className="space-y-3 text-gray-700">
                  <li className="flex gap-3">
                    <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <span>Use strong action verbs to start bullet points</span>
                  </li>
                  <li className="flex gap-3">
                    <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <span>Quantify your achievements with metrics</span>
                  </li>
                  <li className="flex gap-3">
                    <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <span>Tailor your CV to each job posting</span>
                  </li>
                  <li className="flex gap-3">
                    <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <span>Keep it to 1-2 pages for most roles</span>
                  </li>
                </ul>
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-8">
                <button
                  onClick={() => setCvResults(null)}
                  className="px-4 py-2 text-yellow-600 font-medium hover:bg-yellow-50 rounded-lg"
                >
                  ← Analyze Another CV
                </button>
              </div>

              {/* Overall Score */}
              <div className="bg-gradient-to-r from-yellow-500 to-yellow-400 rounded-xl p-8 text-blue-900 mb-8">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold opacity-90">Overall CV Score</p>
                    <p className="text-4xl font-bold">{cvResults.overallScore}/100</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm opacity-90">Great potential!</p>
                    <p className="text-lg font-semibold">Room for optimization</p>
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="mb-6 flex gap-4 border-b border-gray-200">
                <button
                  onClick={() => setCvTab('analysis')}
                  className={`px-4 py-3 font-medium border-b-2 transition-colors ${
                    cvTab === 'analysis'
                      ? 'border-yellow-500 text-blue-900'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Section Analysis
                </button>
                <button
                  onClick={() => setCvTab('expert')}
                  className={`px-4 py-3 font-medium border-b-2 transition-colors ${
                    cvTab === 'expert'
                      ? 'border-yellow-500 text-blue-900'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Expert Review
                </button>
              </div>

              {/* Content */}
              {cvTab === 'analysis' && (
                <div className="space-y-6">
                  {cvResults.sections.map((section, idx) => (
                    <div key={idx} className="bg-gray-50 rounded-xl p-6">
                      <div className="flex justify-between items-start mb-4">
                        <h4 className="text-lg font-serif font-semibold text-blue-900">{section.title}</h4>
                        <div className="text-2xl font-bold text-yellow-500">{section.score}</div>
                      </div>
                      <p className="text-gray-700">{section.feedback}</p>
                    </div>
                  ))}
                </div>
              )}

              {cvTab === 'expert' && (
                <div className="bg-blue-50 rounded-xl p-8">
                  <p className="text-gray-700 text-lg leading-relaxed">{cvResults.expertReview}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Interview Prep View
  if (currentView === 'interview') {
    return (
      <div className="min-h-screen bg-white">
        {renderNavigation()}
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <h1 className="text-4xl font-serif font-bold text-blue-900 mb-4">Interview Preparation</h1>
          <p className="text-gray-600 text-lg mb-12">Master behavioral questions, technical challenges, and company-specific insights.</p>

          <div className="bg-blue-50 rounded-xl p-12 text-center">
            <Brain className="w-16 h-16 text-yellow-500 mx-auto mb-6" />
            <h2 className="text-3xl font-serif font-bold text-blue-900 mb-4">Coming Soon</h2>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto mb-8">
              Our interview preparation module is being crafted to help you ace any interview. Features include mock interviews, behavioral question training, and company research guidance.
            </p>
            <button
              onClick={() => setCurrentView('home')}
              className="px-6 py-3 bg-yellow-500 text-blue-900 rounded-lg font-semibold hover:bg-yellow-400 transition-colors"
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>
    )
  }

  return null
}
