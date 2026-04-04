import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type {
  DreamCompanyInput,
  ProfileAnalysis,
  CompanyMatrix,
  TargetRole,
  CareerRoadmap,
  DreamCompanyResult,
} from '@/types/dream-company'
import {
  buildProfileAnalysisPrompt,
  buildCompanyMatrixPrompt,
  buildTargetRolesPrompt,
  buildCareerRoadmapPrompt,
} from '@/lib/dream-company/prompts'

function cleanJsonResponse(text: string): string {
  return text
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?\s*```$/, '')
    .trim()
}

function extractText(response: Anthropic.Message): string {
  const block = response.content[0]
  if (block.type === 'text') {
    return cleanJsonResponse(block.text)
  }
  return ''
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const profile: DreamCompanyInput = body.profile

    // Validate required fields
    const missing: string[] = []
    if (!profile?.degree) missing.push('degree')
    if (!profile?.workExperience) missing.push('workExperience')
    if (!profile?.skills) missing.push('skills')
    if (!profile?.location) missing.push('location')

    if (missing.length > 0) {
      return NextResponse.json(
        { error: 'Missing required fields', missing },
        { status: 400 }
      )
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })

    const systemMessage = 'You are a career intelligence engine. Return only valid JSON.'

    // ─── INTEGRATION POINT ───────────────────────────────
    // Inject external data here before calling LLM:
    // - Profile Analysis: O*NET skills gap data
    // ─────────────────────────────────────────────────────
    const analysisResponse = await anthropic.messages.create({
      model: 'claude-opus-4-5-20250219',
      max_tokens: 4096,
      system: systemMessage,
      messages: [{ role: 'user', content: buildProfileAnalysisPrompt(profile) }],
    })

    let analysis: ProfileAnalysis
    try {
      analysis = JSON.parse(extractText(analysisResponse))
    } catch {
      return NextResponse.json(
        { error: 'Failed to parse LLM response', step: 'profileAnalysis' },
        { status: 500 }
      )
    }

    // ─── INTEGRATION POINT ───────────────────────────────
    // Inject external data here before calling LLM:
    // - Company Matrix:   Proxycurl / Apollo company enrichment
    // ─────────────────────────────────────────────────────
    const matrixResponse = await anthropic.messages.create({
      model: 'claude-opus-4-5-20250219',
      max_tokens: 4096,
      system: systemMessage,
      messages: [{ role: 'user', content: buildCompanyMatrixPrompt(profile, analysis) }],
    })

    let matrix: CompanyMatrix
    try {
      matrix = JSON.parse(extractText(matrixResponse))
    } catch {
      return NextResponse.json(
        { error: 'Failed to parse LLM response', step: 'companyMatrix' },
        { status: 500 }
      )
    }

    // ─── INTEGRATION POINT ───────────────────────────────
    // Inject external data here before calling LLM:
    // - Target Roles:     Adzuna live job posting counts
    // ─────────────────────────────────────────────────────
    const rolesResponse = await anthropic.messages.create({
      model: 'claude-opus-4-5-20250219',
      max_tokens: 4096,
      system: systemMessage,
      messages: [{ role: 'user', content: buildTargetRolesPrompt(profile, analysis) }],
    })

    let roles: TargetRole[]
    try {
      roles = JSON.parse(extractText(rolesResponse))
    } catch {
      return NextResponse.json(
        { error: 'Failed to parse LLM response', step: 'targetRoles' },
        { status: 500 }
      )
    }

    // ─── INTEGRATION POINT ───────────────────────────────
    // Inject external data here before calling LLM:
    // - Career Roadmap:   O*NET gap data + course links
    // ─────────────────────────────────────────────────────
    const roadmapResponse = await anthropic.messages.create({
      model: 'claude-opus-4-5-20250219',
      max_tokens: 4096,
      system: systemMessage,
      messages: [{ role: 'user', content: buildCareerRoadmapPrompt(profile, analysis) }],
    })

    let roadmap: CareerRoadmap
    try {
      roadmap = JSON.parse(extractText(roadmapResponse))
    } catch {
      return NextResponse.json(
        { error: 'Failed to parse LLM response', step: 'careerRoadmap' },
        { status: 500 }
      )
    }

    const result: DreamCompanyResult = {
      profile,
      analysis,
      matrix,
      roles,
      roadmap,
      generatedAt: new Date(),
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Dream company generation error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
