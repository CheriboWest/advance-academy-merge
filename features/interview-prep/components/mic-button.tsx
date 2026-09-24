'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'

interface MicButtonProps {
  disabled?: boolean
  transcribing: boolean
  onTranscribe: (blob: Blob) => Promise<string>
  onTranscribed: (text: string) => void
}

type RecorderStatus = 'idle' | 'recording' | 'transcribing' | 'unsupported'

function pickSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return undefined
}

export function MicButton({ disabled, transcribing, onTranscribe, onTranscribed }: MicButtonProps) {
  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [localError, setLocalError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)

  useEffect(() => {
    if (typeof window !== 'undefined' && typeof MediaRecorder === 'undefined') {
      setStatus('unsupported')
    }
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop()
        } catch {
          // ignore
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const startRecording = useCallback(async () => {
    setLocalError(null)

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setLocalError('Microphone not supported in this browser.')
      setStatus('unsupported')
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
    } catch (err) {
      const name = err instanceof Error ? err.name : ''
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setLocalError('Microphone permission denied.')
      } else if (name === 'NotFoundError') {
        setLocalError('No microphone found.')
      } else {
        setLocalError('Could not access microphone.')
      }
      return
    }

    streamRef.current = stream
    chunksRef.current = []

    const mimeType = pickSupportedMimeType()
    const recorderOptions: MediaRecorderOptions = { audioBitsPerSecond: 48_000 }
    if (mimeType) recorderOptions.mimeType = mimeType
    const recorder = new MediaRecorder(stream, recorderOptions)
    recorderRef.current = recorder

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data)
    }

    recorder.onstop = async () => {
      stopTimer()
      releaseStream()

      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
      chunksRef.current = []

      if (blob.size === 0) {
        setStatus('idle')
        setLocalError('No audio captured.')
        return
      }

      setStatus('transcribing')
      try {
        const text = await onTranscribe(blob)
        if (text) {
          onTranscribed(text)
        } else {
          setLocalError('Transcription returned no text.')
        }
      } catch {
        // error already surfaced via hook state; component also clears status
      } finally {
        setStatus('idle')
      }
    }

    startTimeRef.current = Date.now()
    setElapsedMs(0)
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current)
    }, 200)

    recorder.start()
    setStatus('recording')
  }, [onTranscribe, onTranscribed, releaseStream, stopTimer])

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop()
    }
  }, [])

  const handleClick = useCallback(() => {
    if (status === 'recording') {
      stopRecording()
    } else if (status === 'idle') {
      void startRecording()
    }
  }, [status, startRecording, stopRecording])

  const isBusy = transcribing || status === 'transcribing'
  const isRecording = status === 'recording'
  const isDisabled = disabled || status === 'unsupported' || isBusy

  const elapsedSeconds = Math.floor(elapsedMs / 1000)
  const mm = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')
  const ss = String(elapsedSeconds % 60).padStart(2, '0')

  let label: string
  let icon: React.ReactNode
  let buttonClass: string

  if (status === 'unsupported') {
    label = 'Mic unsupported'
    icon = <Mic className="w-3.5 h-3.5" />
    buttonClass = 'bg-card text-subtle-foreground cursor-not-allowed'
  } else if (isBusy) {
    label = 'Transcribing...'
    icon = <Loader2 className="w-3.5 h-3.5 animate-spin" />
    buttonClass = 'bg-card text-muted-foreground cursor-wait'
  } else if (isRecording) {
    label = `Stop (${mm}:${ss})`
    icon = <Square className="w-3.5 h-3.5 fill-current" />
    buttonClass = 'bg-red-600 text-primary-foreground hover:bg-red-500'
  } else {
    label = 'Record'
    icon = <Mic className="w-3.5 h-3.5" />
    buttonClass = 'bg-primary/10 text-primary hover:bg-primary/10'
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isDisabled}
        title={
          status === 'unsupported'
            ? 'Your browser does not support audio recording.'
            : isRecording
              ? 'Click to stop recording'
              : 'Click to record your answer'
        }
        className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${buttonClass}`}
      >
        {isRecording && (
          <span className="w-2 h-2 rounded-full bg-background animate-pulse" aria-hidden />
        )}
        {icon}
        {label}
      </button>
      {localError && <p className="text-xs text-red-600">{localError}</p>}
    </div>
  )
}
