"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Conversation, Message, Contact } from "@/types";
import { WifiOff, Send, Camera, Search, Menu, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useRealtime } from "@/hooks/use-realtime";
import { CONVERSATION_SELECT, normalizeConversation, normalizeConversations } from "@/lib/inbox/conversations";

export default function InstagramInboxPage() {
  const t = useTranslations("InstagramInbox");
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkConvId = searchParams.get("c");

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [instagramConnected, setInstagramConnected] = useState<boolean | null>(null);
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [resyncToken, setResyncToken] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Check Instagram connection status
  useEffect(() => {
    const checkConnection = async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("account_id")
        .eq("user_id", user.id)
        .maybeSingle();
      const accountId = profile?.account_id as string | undefined;
      if (!accountId) {
        setInstagramConnected(false);
        return;
      }

      const { data } = await supabase
        .from("instagram_config")
        .select("status")
        .eq("account_id", accountId)
        .maybeSingle();

      setInstagramConnected(data?.status === "connected");
    };
    checkConnection();
  }, []);

  // Fetch Instagram conversations
  useEffect(() => {
    const fetchConversations = async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("conversations")
        .select(CONVERSATION_SELECT)
        .eq("platform", "instagram")
        .order("last_message_at", { ascending: false });
        
      if (!error && data) {
        const normalized = normalizeConversations(data);
        setConversations(normalized);
        if (deepLinkConvId) {
          const match = normalized.find(c => c.id === deepLinkConvId);
          if (match) {
            setActiveConversation(match);
            setActiveContact(match.contact ?? null);
          }
        }
      }
    };
    fetchConversations();
  }, [resyncToken, deepLinkConvId]);

  // Fetch messages when conversation selected
  useEffect(() => {
    if (!activeConversation) return;
    const fetchMessages = async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", activeConversation.id)
        .order("created_at", { ascending: true });
        
      if (!error && data) {
        setMessages(data);
      }
    };
    fetchMessages();
  }, [activeConversation?.id, resyncToken]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSelectConversation = useCallback((conv: Conversation) => {
    if (activeConversation?.id === conv.id) return;
    setActiveConversation(conv);
    setActiveContact(conv.contact ?? null);
    setMessages([]);
    router.replace(`/instagram/inbox?c=${conv.id}`, { scroll: false });
  }, [activeConversation?.id, router]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim() || !activeConversation) return;
    
    setSending(true);
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: Message = {
      id: tempId,
      conversation_id: activeConversation.id,
      sender_type: "agent",
      status: "sending",
      content_type: "text",
      content_text: messageText,
      created_at: new Date().toISOString(),
    };
    
    setMessages(prev => [...prev, optimisticMsg]);
    const textToSend = messageText;
    setMessageText("");

    try {
      const res = await fetch("/api/instagram/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeConversation.id, text: textToSend }),
      });
      
      if (!res.ok) {
        throw new Error("Failed to send");
      }
    } catch (err) {
      toast.error(t("sendError", { fallback: "Failed to send message" }));
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setMessageText(textToSend);
    } finally {
      setSending(false);
    }
  };

  const handleMessageEvent = useCallback((event: any) => {
    if (event.eventType === "INSERT") {
      const newMsg = event.new as Message;
      if (activeConversation && newMsg.conversation_id === activeConversation.id) {
        setMessages(prev => {
          if (prev.some(m => m.id === newMsg.id)) return prev;
          const withoutTemp = prev.filter(m => !m.id.startsWith("temp-"));
          return [...withoutTemp, newMsg];
        });
      }
      // Update conv list
      setConversations(prev => prev.map(c => 
        c.id === newMsg.conversation_id 
          ? { ...c, last_message_text: newMsg.content_text ?? "", last_message_at: newMsg.created_at } 
          : c
      ));
    } else if (event.eventType === "UPDATE") {
      const updatedMsg = event.new as Message;
      setMessages(prev => prev.map(m => m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m));
    }
  }, [activeConversation]);

  const handleConversationEvent = useCallback((event: any) => {
    const conv = event.new as Conversation;
    if (event.eventType === "INSERT") {
      // In real scenario, need to hydrate contact
      if (conv.platform === 'instagram') {
        setResyncToken(prev => prev + 1);
      }
    } else if (event.eventType === "UPDATE") {
      if (conv.platform === 'instagram') {
        setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, ...conv } : c));
        if (activeConversation?.id === conv.id) {
          setActiveConversation(prev => prev ? { ...prev, ...conv } : prev);
        }
      }
    }
  }, [activeConversation]);

  const { isConnected } = useRealtime({
    channelName: "instagram-realtime",
    onMessageEvent: handleMessageEvent,
    onConversationEvent: handleConversationEvent,
    enabled: true,
  });

  const filteredConversations = conversations.filter(c => 
    c.contact?.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.contact?.phone?.toLowerCase().includes(search.toLowerCase())
  );

  const hasActiveConv = !!activeConversation;

  return (
    <div className="-m-4 flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden sm:-m-6">
      {instagramConnected === false && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-rose-500/20 bg-rose-500/10 px-4 py-2">
          <WifiOff className="h-4 w-4 text-rose-500" />
          <div className="flex flex-col sm:flex-row items-center gap-1 sm:gap-2">
            <p className="text-xs text-rose-600 font-medium">
              {t("connectionWarning")}
            </p>
            <p className="text-xs text-rose-500 hidden sm:block">
              {t("connectionWarningDesc")}
            </p>
            <a href="/settings/channels" className="text-xs text-rose-700 underline font-semibold ml-2">
              {t("goToSettings")}
            </a>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden bg-background">
        {/* Left Panel */}
        <div className={cn("flex h-full w-full flex-col border-r lg:w-80 xl:w-96 lg:flex", hasActiveConv ? "hidden lg:flex" : "flex")}>
          <div className="p-4 border-b space-y-4">
            <div className="flex items-center gap-2 text-rose-600">
              <Camera className="h-5 w-5" />
              <h2 className="font-semibold">{t("title")}</h2>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder={t("searchPlaceholder")}
                className="w-full rounded-md border border-input bg-transparent px-9 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredConversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-4 text-muted-foreground">
                <MessageCircle className="h-10 w-10 mb-4 opacity-20" />
                <p className="font-medium text-foreground">{t("noConversations")}</p>
                <p className="text-sm mt-1">{t("noConversationsDesc")}</p>
              </div>
            ) : (
              <ul className="divide-y">
                {filteredConversations.map(conv => (
                  <li key={conv.id}>
                    <button
                      onClick={() => handleSelectConversation(conv)}
                      className={cn(
                        "w-full text-left p-4 hover:bg-muted/50 transition-colors focus:outline-none",
                        activeConversation?.id === conv.id && "bg-muted"
                      )}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-medium truncate pr-2">
                          {conv.contact?.name || "Unknown"}
                        </span>
                        {conv.last_message_at && (
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDistanceToNow(new Date(conv.last_message_at), { addSuffix: true })}
                          </span>
                        )}
                      </div>
                      <div className="flex justify-between items-center gap-2">
                        <p className="text-sm text-muted-foreground truncate flex-1">
                          {conv.last_message_text || "..."}
                        </p>
                        {conv.unread_count > 0 && (
                          <span className="bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                            {conv.unread_count}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Center Panel */}
        <div className={cn("flex-1 flex-col h-full bg-background lg:flex", hasActiveConv ? "flex" : "hidden lg:flex")}>
          {activeConversation ? (
            <>
              {/* Header */}
              <div className="flex items-center gap-3 p-4 border-b bg-card">
                <button
                  onClick={() => {
                    setActiveConversation(null);
                    router.replace("/instagram/inbox", { scroll: false });
                  }}
                  className="lg:hidden p-2 -ml-2 rounded-md hover:bg-muted"
                >
                  <Menu className="h-5 w-5" />
                </button>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate">{activeContact?.name || "Unknown"}</h3>
                  {activeContact?.phone && (
                    <p className="text-xs text-muted-foreground truncate">IGSID: {activeContact.phone}</p>
                  )}
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-muted/20">
                {messages.map(msg => {
                  const isOutbound = msg.sender_type !== "customer";
                  return (
                    <div key={msg.id} className={cn("flex", isOutbound ? "justify-end" : "justify-start")}>
                      <div className={cn(
                        "max-w-[75%] rounded-2xl px-4 py-2",
                        isOutbound ? "bg-rose-600 text-white rounded-br-none" : "bg-card border shadow-sm rounded-bl-none"
                      )}>
                        <p className="text-sm whitespace-pre-wrap">{msg.content_text}</p>
                        <div className={cn(
                          "text-[10px] mt-1 text-right",
                          isOutbound ? "text-rose-100" : "text-muted-foreground"
                        )}>
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {isOutbound && msg.status === "sending" && " • Sending"}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Composer */}
              <div className="p-4 bg-card border-t">
                <form onSubmit={handleSendMessage} className="flex gap-2">
                  <input
                    type="text"
                    value={messageText}
                    onChange={e => setMessageText(e.target.value)}
                    placeholder={t("typeMessage")}
                    className="flex-1 rounded-full border border-input bg-transparent px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-500"
                    disabled={sending}
                  />
                  <button
                    type="submit"
                    disabled={!messageText.trim() || sending}
                    className="flex items-center justify-center rounded-full bg-rose-600 p-2.5 text-white hover:bg-rose-700 disabled:opacity-50 transition-colors"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-muted/10">
              <div className="text-center">
                <Camera className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-20" />
                <h3 className="font-medium">{t("selectConversation")}</h3>
                <p className="text-sm text-muted-foreground mt-1">{t("selectConversationDesc")}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
