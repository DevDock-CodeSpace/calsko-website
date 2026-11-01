import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** Copyable one-line value: the webhook URL and its token. */
export function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Couldn’t copy. Select the text and copy it instead.')
    }
  }
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex gap-2">
        <Input readOnly value={value} className={cn('font-mono text-xs', secret && 'tracking-tight')} onFocus={(e) => e.currentTarget.select()} />
        <Button type="button" variant="outline" size="icon" onClick={() => void copy()} aria-label={`Copy ${label.toLowerCase()}`}>
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  )
}
