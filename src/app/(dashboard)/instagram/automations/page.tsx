"use client"

import { useEffect, useState, KeyboardEvent } from "react"
import { useTranslations } from "next-intl"
import { Plus, Pencil, Trash2, Clock, Check, X, Tag, Power, AlertCircle } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { GatedButton } from "@/components/ui/gated-button"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useCan } from "@/hooks/use-can"
import { cn } from "@/lib/utils"

interface Automation {
  id: string
  name: string
  keywords: string[]
  match_type: "contains" | "exact"
  case_sensitive: boolean
  reply_message: string
  comment_reply_text: string | null
  is_active: boolean
  execution_count: number
  last_executed_at: string | null
  created_at: string
}

export default function InstagramAutomationsPage() {
  const t = useTranslations("InstagramAutomations")
  const canManage = useCan("edit-settings")
  
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Automation | null>(null)
  
  // Form state
  const [name, setName] = useState("")
  const [keywords, setKeywords] = useState<string[]>([])
  const [keywordInput, setKeywordInput] = useState("")
  const [matchType, setMatchType] = useState<"contains" | "exact">("contains")
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [replyMessage, setReplyMessage] = useState("")
  const [commentReplyText, setCommentReplyText] = useState("")
  const [isActive, setIsActive] = useState(true)

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function loadAutomations() {
    setLoading(true)
    try {
      const res = await fetch("/api/instagram/automations")
      if (!res.ok) throw new Error(t("error"))
      const data = await res.json()
      setAutomations(data.automations || [])
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAutomations()
  }, [])

  function resetForm() {
    setName("")
    setKeywords([])
    setKeywordInput("")
    setMatchType("contains")
    setCaseSensitive(false)
    setReplyMessage("")
    setCommentReplyText("")
    setIsActive(true)
    setEditingAutomation(null)
  }

  function openNewModal() {
    resetForm()
    setIsModalOpen(true)
  }

  function openEditModal(auto: Automation) {
    setEditingAutomation(auto)
    setName(auto.name)
    setKeywords(auto.keywords)
    setKeywordInput("")
    setMatchType(auto.match_type)
    setCaseSensitive(auto.case_sensitive)
    setReplyMessage(auto.reply_message)
    setCommentReplyText(auto.comment_reply_text || "")
    setIsActive(auto.is_active)
    setIsModalOpen(true)
  }

  function handleKeywordKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && keywordInput.trim()) {
      e.preventDefault()
      if (!keywords.includes(keywordInput.trim())) {
        setKeywords([...keywords, keywordInput.trim()])
      }
      setKeywordInput("")
    }
  }

  function removeKeyword(index: number) {
    setKeywords(keywords.filter((_, i) => i !== index))
  }

  async function saveAutomation() {
    if (!name.trim() || keywords.length === 0 || !replyMessage.trim()) {
      toast.error(t("error"))
      return
    }

    setSaving(true)
    try {
      const body = {
        name: name.trim(),
        keywords,
        match_type: matchType,
        case_sensitive: caseSensitive,
        reply_message: replyMessage.trim(),
        comment_reply_text: commentReplyText.trim() || null,
        is_active: isActive,
      }

      let res
      if (editingAutomation) {
        res = await fetch(`/api/instagram/automations?id=${editingAutomation.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      } else {
        res = await fetch("/api/instagram/automations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      }

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || t("error"))
      }

      toast.success(editingAutomation ? t("updateSuccess") : t("createSuccess"))
      setIsModalOpen(false)
      loadAutomations()
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(auto: Automation, nextActive: boolean) {
    setAutomations(prev => prev.map(a => a.id === auto.id ? { ...a, is_active: nextActive } : a))
    
    try {
      const res = await fetch(`/api/instagram/automations?id=${auto.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: nextActive }),
      })
      
      if (!res.ok) throw new Error(t("error"))
      toast.success(t("updateSuccess"))
    } catch (error: any) {
      toast.error(error.message)
      // Rollback
      setAutomations(prev => prev.map(a => a.id === auto.id ? { ...a, is_active: !nextActive } : a))
    }
  }

  async function deleteAutomation() {
    if (!pendingDelete) return
    
    setDeleting(true)
    try {
      const res = await fetch(`/api/instagram/automations?id=${pendingDelete.id}`, {
        method: "DELETE",
      })
      
      if (!res.ok) throw new Error(t("error"))
      
      toast.success(t("deleteSuccess"))
      setPendingDelete(null)
      loadAutomations()
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Loading...</div>
  }

  return (
    <div className="container max-w-5xl py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground mt-1">{t("description")}</p>
        </div>
        <GatedButton 
          role="admin" 
          onClick={openNewModal}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          {t("newAutomation")}
        </GatedButton>
      </div>

      {automations.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <div className="mx-auto bg-muted/50 w-12 h-12 rounded-full flex items-center justify-center mb-4">
              <Plus className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-2">{t("noAutomations")}</h3>
            <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
              {t("noAutomationsDesc")}
            </p>
            <GatedButton role="admin" onClick={openNewModal}>
              {t("newAutomation")}
            </GatedButton>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {automations.map(auto => (
            <Card key={auto.id} className={cn(!auto.is_active && "opacity-75")}>
              <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0">
                <div className="space-y-1">
                  <CardTitle className="text-base flex items-center gap-2">
                    {auto.name}
                  </CardTitle>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {auto.keywords.map(kw => (
                      <Badge key={kw} variant="secondary" className="text-xs">
                        {kw}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Switch 
                  checked={auto.is_active} 
                  onCheckedChange={(checked) => toggleActive(auto, checked)}
                  disabled={!canManage}
                />
              </CardHeader>
              <CardContent className="pb-3 text-sm">
                <div className="text-muted-foreground line-clamp-2">
                  <span className="font-medium text-foreground mr-1">Direct:</span>
                  {auto.reply_message}
                </div>
                {auto.comment_reply_text && (
                  <div className="text-muted-foreground line-clamp-1 mt-1">
                    <span className="font-medium text-foreground mr-1">Reply:</span>
                    {auto.comment_reply_text}
                  </div>
                )}
              </CardContent>
              <CardFooter className="pt-3 border-t text-xs text-muted-foreground flex justify-between">
                <div className="flex gap-4">
                  <span className="flex items-center gap-1">
                    <Power className="h-3 w-3" />
                    {auto.execution_count} {t("executions")}
                  </span>
                  {auto.last_executed_at && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(auto.last_executed_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8"
                    onClick={() => openEditModal(auto)}
                    disabled={!canManage}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => setPendingDelete(auto)}
                    disabled={!canManage}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* Edit / Create Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingAutomation ? t("edit") : t("newAutomation")}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t("name")}</Label>
              <Input 
                id="name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t("namePlaceholder")}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("keywords")}</Label>
              <div className="flex flex-wrap gap-2 mb-2">
                {keywords.map((kw, i) => (
                  <Badge key={i} variant="secondary" className="flex items-center gap-1 py-1">
                    {kw}
                    <button 
                      onClick={() => removeKeyword(i)}
                      className="ml-1 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <Input 
                value={keywordInput}
                onChange={e => setKeywordInput(e.target.value)}
                onKeyDown={handleKeywordKeyDown}
                placeholder={t("keywordsPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">{t("keywordsHelp")}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("matchType")}</Label>
                <Select value={matchType} onValueChange={(val) => { if (val) setMatchType(val as "contains" | "exact") }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contains">{t("matchContains")}</SelectItem>
                    <SelectItem value="exact">{t("matchExact")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 flex flex-col justify-end">
                <div className="flex items-center space-x-2 h-10">
                  <Checkbox 
                    id="caseSensitive" 
                    checked={caseSensitive}
                    onCheckedChange={(c) => setCaseSensitive(!!c)}
                  />
                  <Label htmlFor="caseSensitive" className="font-normal cursor-pointer">
                    {t("caseSensitive")}
                  </Label>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reply">{t("replyMessage")}</Label>
              <Textarea 
                id="reply"
                value={replyMessage}
                onChange={e => setReplyMessage(e.target.value)}
                placeholder={t("replyMessagePlaceholder")}
                className="min-h-[100px]"
              />
              <p className="text-xs text-muted-foreground">{t("replyMessageHelp")}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="commentReply">{t("commentReply")}</Label>
              <Textarea 
                id="commentReply"
                value={commentReplyText}
                onChange={e => setCommentReplyText(e.target.value)}
                placeholder={t("commentReplyPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">{t("commentReplyHelp")}</p>
            </div>

            <div className="flex items-center justify-between border rounded-lg p-4 bg-muted/30">
              <div className="space-y-0.5">
                <Label className="text-base">{t(isActive ? "active" : "inactive")}</Label>
                <p className="text-sm text-muted-foreground">
                  Status da automação
                </p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={saveAutomation} disabled={saving}>
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("delete")}</DialogTitle>
            <DialogDescription>
              {t("deleteConfirm")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={deleting}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={deleteAutomation} disabled={deleting}>
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
