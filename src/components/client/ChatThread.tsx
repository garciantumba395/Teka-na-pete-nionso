"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { useHydrated } from "./useHydrated";
import type { ChatMessage } from "@/lib/types";

// Fuseau fixe : le serveur et le navigateur doivent afficher la même heure (sinon erreur d'hydratation).
const timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kinshasa" });
const dayFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "Africa/Kinshasa" });
const POLL_MS = 4000;

function merge(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of [...a, ...b]) byId.set(m.id, m);
  return [...byId.values()].sort((x, y) => x.createdAt - y.createdAt);
}

export function ChatThread({ conversationId, initial, canWrite = true }: { conversationId: string; initial: ChatMessage[]; canWrite?: boolean }) {
  const hydrated = useHydrated();
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const count = useRef(initial.length);

  const refresh = useCallback(async () => {
    if (document.hidden) return;
    try {
      const r = await api<{ conversation: { messages: ChatMessage[] } }>(`/conversations/${conversationId}`);
      setMessages((cur) => merge(cur, r.conversation.messages));
    } catch {
      /* réseau instable : on réessaie au prochain tour */
    }
  }, [conversationId]);

  useEffect(() => {
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (messages.length !== count.current) {
      count.current = messages.length;
      endRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (busy || !body) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ message: ChatMessage }>(`/conversations/${conversationId}/messages`, { body: { body } });
      setMessages((cur) => merge(cur, [r.message]));
      setText("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Le message n'est pas parti. Réessaie.");
    } finally {
      setBusy(false);
    }
  }

  let lastDay = "";
  return (
    <div className="chat">
      <div className="chat-log" role="log" aria-label="Messages" aria-live="polite" tabIndex={0}>
        {messages.length === 0 && <p className="hint" style={{ textAlign: "center" }}>Aucun message pour l&apos;instant. Dis bonjour et pose ta question sur l&apos;article.</p>}
        {messages.map((m) => {
          const day = dayFmt.format(m.createdAt);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={m.id} style={{ display: "contents" }}>
              {showDay && <div className="chat-day">{day}</div>}
              <div className={`bubble ${m.kind === "system" ? "system" : m.mine ? "mine" : "theirs"}`}>
                <span className="sr-only">{m.mine ? "Toi : " : "Lui ou elle : "}</span>
                <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.body}</span>
                <time className="bubble-time tnum" dateTime={new Date(m.createdAt).toISOString()}>{timeFmt.format(m.createdAt)}</time>
                {m.flagged && (
                  <span className="bubble-warn">Garde tes échanges et ton paiement dans l&apos;appli : c&apos;est ce qui te protège. Ne paie jamais en dehors.</span>
                )}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {canWrite ? (
        <form className="chat-form" onSubmit={send}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="msg" className="sr-only">Ton message</label>
            <textarea
              id="msg" className="input" rows={2} maxLength={2000} value={text} placeholder="Écris ton message"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              aria-describedby={error ? "msg-err" : "msg-hint"}
            />
            <span id="msg-hint" className="hint">Entrée envoie, Maj+Entrée va à la ligne.</span>
            {error && <span id="msg-err" className="error" role="alert">{error}</span>}
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy || !hydrated || text.trim().length === 0} aria-busy={busy || undefined}>Envoyer</button>
        </form>
      ) : (
        <p className="hint" style={{ textAlign: "center" }}>Ce membre a supprimé son compte : tu ne peux plus lui écrire.</p>
      )}
    </div>
  );
}
