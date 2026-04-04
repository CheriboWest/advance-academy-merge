import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

function cleanJsonResponse(text: string): string {
  return text
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?\s*```$/, '')
    .trim()
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('cv') as File | null

    if (!file) {
      return NextResponse.json(
        { error: 'No CV file provided' },
        { status: 400 }
      )
    }

    const fileName = file.name.toLowerCase()
    const isPdf = fileName.endsWith('.pdf')
    const isDocx = fileName.endsWith('.docx')

    if (!isPdf && !isDocx) {
      return NextResponse.json(
        { error: 'Only PDF and DOCX files are supported' },
        { status: 400 }
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    let extractedText: string

    if (isPdf) {
      const pdfParse = (await import('pdf-parse')).default
      const pdfData = await pdfParse(buffer)
      extractedText = pdfData.text
    } else {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer })
      extractedText = result.value
    }

    if (!extractedText.trim()) {
      return NextResponse.json(
        { error: 'Could not extract text from the uploaded file' },
        { status: 422 }
      )
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5-20250219',
      max_tokens: 2048,
      system: 'You are a CV parser. Extract career information and return only valid JSON.',
      messages: [
        {
          role: 'user',
          content: `Extract structured career information from the following CV text and map it to the specified fields.

CV TEXT:
${extractedText}

YOUR TASK:
Parse the CV and extract the following fields:
- degree: highest education degree (e.g., "Bachelor of Computer Science")
- workExperience: summary of work experience as a single string describing roles and companies
- skills: comma-separated list of technical and soft skills mentioned
- interests: professional interests or areas of focus mentioned
- targetSalary: any salary expectations mentioned, or empty string if not found
- location: candidate's location or preferred work location

Also determine:
- currentLevel: the candidate's current career level — one of: intern, junior, mid, senior, lead, manager, director, executive
- confidence: an object with confidence levels for each extracted field:
  { "degree": "high"|"medium"|"low", "workExperience": "high"|"medium"|"low", "skills": "high"|"medium"|"low", "location": "high"|"medium"|"low" }

Use empty string "" for any field that cannot be determined from the CV.

Return ONLY a valid JSON object matching this schema:
{
  "degree": "string",
  "workExperience": "string",
  "skills": "string",
  "interests": "string",
  "targetSalary": "string",
  "location": "string",
  "currentLevel": "intern"|"junior"|"mid"|"senior"|"lead"|"manager"|"director"|"executive",
  "confidence": {
    "degree": "high"|"medium"|"low",
    "workExperience": "high"|"medium"|"low",
    "skills": "high"|"medium"|"low",
    "location": "high"|"medium"|"low"
  }
}

Return ONLY a valid JSON object. No explanation, no markdown, no code blocks.`,
        },
      ],
    })

    const block = response.content[0]
    if (block.type !== 'text') {
      return NextResponse.json(
        { error: 'Failed to parse CV' },
        { status: 500 }
      )
    }

    const parsed = JSON.parse(cleanJsonResponse(block.text))
    return NextResponse.json(parsed)
  } catch (error) {
    console.error('CV parse error:', error)
    return NextResponse.json(
      { error: 'Failed to parse CV' },
      { status: 500 }
    )
  }
}
