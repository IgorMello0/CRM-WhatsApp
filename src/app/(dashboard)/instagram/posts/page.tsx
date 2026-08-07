"use client"

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Plus, Image as ImageIcon, Video, Film, ExternalLink, AlertCircle } from 'lucide-react'

type PostStatus = 'draft' | 'publishing' | 'published' | 'failed'
type MediaType = 'image' | 'video' | 'reel'

interface InstagramPost {
  id: string
  media_type: MediaType
  media_url: string
  caption: string | null
  status: PostStatus
  permalink?: string
  error_message?: string
  created_at: string
}

export default function InstagramPostsPage() {
  const t = useTranslations('InstagramPosts')
  
  const [posts, setPosts] = useState<InstagramPost[]>([])
  const [loading, setLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  
  // New Post Form State
  const [mediaUrl, setMediaUrl] = useState('')
  const [caption, setCaption] = useState('')
  const [mediaType, setMediaType] = useState<MediaType>('image')
  
  const loadPosts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/instagram/posts')
      if (res.ok) {
        const data = await res.json()
        setPosts(data)
      }
    } catch (err) {
      console.error('Failed to load posts', err)
    } finally {
      setLoading(false)
    }
  }, [])
  
  useEffect(() => {
    loadPosts()
  }, [loadPosts])
  
  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mediaUrl) return
    
    setIsPublishing(true)
    setPublishError(null)
    
    try {
      const res = await fetch('/api/instagram/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaType,
          mediaUrl,
          caption
        })
      })
      
      const data = await res.json()
      
      if (!res.ok) {
        throw new Error(data.error || t('publishError'))
      }
      
      // Refresh posts and close modal
      await loadPosts()
      setIsModalOpen(false)
      
      // Reset form
      setMediaUrl('')
      setCaption('')
      setMediaType('image')
      
    } catch (err: any) {
      setPublishError(err.message)
    } finally {
      setIsPublishing(false)
    }
  }

  const getStatusBadge = (status: PostStatus) => {
    switch (status) {
      case 'published':
        return <Badge className="bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800">{t('published')}</Badge>
      case 'publishing':
        return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800">{t('publishing')}</Badge>
      case 'failed':
        return <Badge variant="destructive">{t('failed')}</Badge>
      default:
        return <Badge variant="outline">{t('draft')}</Badge>
    }
  }
  
  const getMediaTypeIcon = (type: MediaType) => {
    switch (type) {
      case 'video': return <Video className="size-4" />
      case 'reel': return <Film className="size-4" />
      default: return <ImageIcon className="size-4" />
    }
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto p-4 md:p-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('description')}
          </p>
        </div>
        
        <Button className="shrink-0 gap-2" onClick={() => setIsModalOpen(true)}>
          <Plus className="size-4" />
          {t('newPost')}
        </Button>
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('newPost')}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handlePublish} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>{t('mediaType')}</Label>
                <Select value={mediaType} onValueChange={(val) => { if (val) setMediaType(val as MediaType) }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="image">{t('image')}</SelectItem>
                    <SelectItem value="video">{t('video')}</SelectItem>
                    <SelectItem value="reel">{t('reel')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>{t('mediaUrl')}</Label>
                <Input
                  required
                  type="url"
                  placeholder={t('mediaUrlPlaceholder')}
                  value={mediaUrl}
                  onChange={(e) => setMediaUrl(e.target.value)}
                />
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label>{t('caption')}</Label>
                  <span className="text-xs text-muted-foreground">
                    {t('charCount', { count: caption.length })}
                  </span>
                </div>
                <Textarea
                  className="resize-none h-32"
                  placeholder={t('captionPlaceholder')}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  maxLength={2200}
                />
              </div>
              
              {publishError && (
                <div className="flex items-center gap-2 p-3 text-sm text-destructive bg-destructive/10 rounded-md">
                  <AlertCircle className="size-4" />
                  <span>{publishError}</span>
                </div>
              )}
              
              <div className="pt-4 flex justify-end">
                <Button type="submit" disabled={isPublishing || !mediaUrl}>
                  {isPublishing ? t('publishing') : t('publishNow')}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-72 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="size-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <ImageIcon className="size-6 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium text-foreground">{t('noPosts')}</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-sm mx-auto">
            {t('noPostsDesc')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {posts.map((post) => (
            <Card key={post.id} className="overflow-hidden flex flex-col">
              <div className="aspect-square bg-muted relative overflow-hidden group">
                {post.media_type === 'image' ? (
                  <img 
                    src={post.media_url} 
                    alt="Post media" 
                    className="object-cover w-full h-full"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjY2JjYmNiIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiByeD0iMiIgcnk9IjIiLz48Y2lyY2xlIGN4PSI4LjUiIGN5PSI4LjUiIHI9IjEuNSIvPjxwb2x5bGluZSBwb2ludHM9IjIxIDE1IDE2IDEwIDUgMjEiLz48L3N2Zz4='
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    {getMediaTypeIcon(post.media_type)}
                  </div>
                )}
                <div className="absolute top-2 right-2">
                  {getStatusBadge(post.status)}
                </div>
              </div>
              
              <CardContent className="p-4 flex-1">
                <p className="text-sm line-clamp-2 text-foreground/90 whitespace-pre-wrap">
                  {post.caption || <span className="text-muted-foreground italic">Sem legenda</span>}
                </p>
                {post.error_message && (
                  <p className="mt-2 text-xs text-destructive flex items-start gap-1">
                    <AlertCircle className="size-3 mt-0.5 shrink-0" />
                    <span className="line-clamp-2">{post.error_message}</span>
                  </p>
                )}
              </CardContent>
              
              <CardFooter className="p-4 pt-0 flex items-center justify-between mt-auto">
                <span className="text-xs text-muted-foreground">
                  {new Date(post.created_at).toLocaleDateString()}
                </span>
                
                {post.permalink && (
                  <a 
                    href={post.permalink} 
                    target="_blank" 
                    rel="noreferrer noopener"
                    className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
                  >
                    {t('viewOnInstagram')}
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
