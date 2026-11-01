import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

/** A copyable block of text (a payload template, a command), with its copy button in the corner. */
export function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Couldn’t copy. Select the text and copy it instead.')
    }
  }
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="relative">
        <pre className="max-h-56 overflow-auto rounded-md bg-muted p-3 pr-11 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
          {text}
        </pre>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="absolute top-1.5 right-1.5 size-7"
          onClick={() => void copy()}
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  )
}
