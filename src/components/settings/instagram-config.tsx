'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, ExternalLink, CheckCircle2, XCircle, RefreshCw, Loader2, Copy } from 'lucide-react';
import { SettingsPanelHead } from './settings-panel-head';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export function InstagramConfig() {
  const t = useTranslations('InstagramConfig');
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [config, setConfig] = useState<any>(null);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/instagram/config');
      if (res.ok) {
        const data = await res.json();
        if (data.connected) {
          setConfig(data);
        } else {
          setConfig(null);
        }
      } else {
        setConfig(null);
      }
    } catch (err) {
      console.error(err);
      toast.error(t('errorLoading'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleDisconnect = async () => {
    if (!confirm(t('disconnectConfirm'))) return;
    
    setDisconnecting(true);
    try {
      const res = await fetch('/api/instagram/config', {
        method: 'DELETE',
      });
      if (res.ok) {
        toast.success(t('successDisconnected'));
        setConfig(null);
      } else {
        toast.error(t('errorDisconnecting'));
      }
    } catch (err) {
      console.error(err);
      toast.error(t('errorDisconnecting'));
    } finally {
      setDisconnecting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t('webhookUrlCopied'));
  };

  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/instagram/webhook` : '';

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">{t('loading')}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
      />

      {!config ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              {t('title')}
            </CardTitle>
            <CardDescription>{t('connectDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex justify-center py-6">
              <Button 
                size="lg" 
                className="bg-[#1877F2] hover:bg-[#0C63D4] text-white flex items-center gap-2"
                onClick={() => window.location.href = '/api/instagram/auth'}
              >
                <Camera className="h-5 w-5" />
                {t('connectButton')}
              </Button>
            </div>

            <Alert>
              <AlertTitle>{t('requirementTitle')}</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>{t('requirement1')}</li>
                  <li>{t('requirement2')}</li>
                  <li>{t('requirement3')}</li>
                </ul>
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <Camera className="h-5 w-5" />
                  {t('connectedAccount')}
                </CardTitle>
                <CardDescription>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 dark:bg-green-500/20 dark:text-green-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {t('statusConnected')}
                  </span>
                </CardDescription>
              </div>
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={handleDisconnect}
                disabled={disconnecting}
              >
                {disconnecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t('disconnectButton')}
              </Button>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">{t('username')}</dt>
                  <dd className="mt-1 text-sm font-semibold">{config.username}</dd>
                </div>
                {config.pageName && (
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">{t('pageName')}</dt>
                    <dd className="mt-1 text-sm">{config.pageName}</dd>
                  </div>
                )}
                {config.connectedAt && (
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">{t('connectedAt')}</dt>
                    <dd className="mt-1 text-sm">{new Date(config.connectedAt).toLocaleDateString()}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('webhookTitle')}</CardTitle>
              <CardDescription>{t('webhookDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t('webhookUrl')}</Label>
                <div className="flex gap-2">
                  <Input readOnly value={webhookUrl} />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(webhookUrl)}
                    title={t('webhookUrlCopied')}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('webhookFields')}</Label>
                <Input readOnly value={t('webhookFieldsList')} className="bg-muted font-mono text-sm" />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
