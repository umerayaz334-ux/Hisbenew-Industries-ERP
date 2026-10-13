import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api/api";
import { formatUtcLocal } from "../utils/dateUtils";
import "./WebsiteVisitors.css";

const eventLabels = {
  page_view: "Page view",
  add_to_cart: "Added to cart",
  chat_message: "Visitor message",
  agent_reply: "Agent reply",
};

const sessionDisplayName = (session) =>
  session?.visitor_name || session?.visitor_contact || "Website Visitor";

const shortSessionId = (sessionId = "") => {
  const value = String(sessionId || "");
  if (value.length <= 12) return value || "visitor";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
};

const cleanPath = (path) => {
  const value = String(path || "").trim();
  if (!value) return "Website";
  return value === "/" ? "Home" : value;
};

function WebsiteVisitors() {
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef(null);

  const selectedSession = useMemo(
    () => sessions.find((item) => item.session_id === selectedSessionId) || detail?.session || null,
    [detail, selectedSessionId, sessions]
  );

  const totals = useMemo(() => {
    return sessions.reduce(
      (summary, session) => ({
        active: summary.active + (session.is_active ? 1 : 0),
        unread: summary.unread + Number(session.unread_count || 0),
        carts: summary.carts + Number(session.add_to_cart_count || 0),
      }),
      { active: 0, unread: 0, carts: 0 }
    );
  }, [sessions]);

  const loadSessions = useCallback(async ({ keepSelection = true } = {}) => {
    setLoadingSessions(true);
    try {
      const response = await api.get("/visitor-chat/sessions", {
        params: { q: query.trim() || undefined, limit: 160 },
      });
      const nextSessions = Array.isArray(response.data) ? response.data : [];
      setSessions(nextSessions);
      setSelectedSessionId((current) => {
        if (keepSelection && current && nextSessions.some((item) => item.session_id === current)) {
          return current;
        }
        return nextSessions[0]?.session_id || null;
      });
      setError("");
    } catch (loadError) {
      console.error("Website visitor sessions loading error:", loadError);
      setError(loadError.response?.data?.detail || "Unable to load website visitors.");
    } finally {
      setLoadingSessions(false);
    }
  }, [query]);

  const loadDetail = useCallback(async (sessionId, { quiet = false } = {}) => {
    if (!sessionId) {
      setDetail(null);
      return;
    }
    if (!quiet) setLoadingDetail(true);
    try {
      const response = await api.get(`/visitor-chat/sessions/${encodeURIComponent(sessionId)}`);
      const nextDetail = response.data || null;
      setDetail(nextDetail);
      if (Number(nextDetail?.session?.unread_count || 0) > 0) {
        await api.patch(`/visitor-chat/sessions/${encodeURIComponent(sessionId)}/read`);
        setSessions((current) =>
          current.map((item) =>
            item.session_id === sessionId ? { ...item, unread_count: 0 } : item
          )
        );
        setDetail((current) => current ? { ...current, session: { ...current.session, unread_count: 0 } } : current);
      }
      setError("");
    } catch (loadError) {
      console.error("Website visitor detail loading error:", loadError);
      setError(loadError.response?.data?.detail || "Unable to load this visitor.");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => loadSessions({ keepSelection: true }), 180);
    return () => window.clearTimeout(timeoutId);
  }, [loadSessions]);

  useEffect(() => {
    if (!selectedSessionId) return undefined;
    loadDetail(selectedSessionId);
    const intervalId = window.setInterval(() => {
      loadDetail(selectedSessionId, { quiet: true });
      loadSessions({ keepSelection: true });
    }, 20000);
    return () => window.clearInterval(intervalId);
  }, [loadDetail, loadSessions, selectedSessionId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ block: "end" });
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [detail?.messages?.length, selectedSessionId]);

  const sendReply = async (event) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !selectedSessionId || sending) return;
    setSending(true);
    setError("");
    try {
      await api.post(`/visitor-chat/sessions/${encodeURIComponent(selectedSessionId)}/messages`, { body });
      setDraft("");
      await loadDetail(selectedSessionId, { quiet: true });
      await loadSessions({ keepSelection: true });
    } catch (sendError) {
      console.error("Website visitor reply error:", sendError);
      setError(sendError.response?.data?.detail || "Reply could not be sent.");
    } finally {
      setSending(false);
    }
  };

  const messages = Array.isArray(detail?.messages) ? detail.messages : [];
  const activities = Array.isArray(detail?.activities) ? detail.activities : [];

  return (
    <div className="website-visitors-page">
      <header className="website-visitors-header">
        <div>
          <span className="website-visitors-kicker">Website</span>
          <h1>Visitor Chat</h1>
          <p>Live website sessions, product activity, carts, and messages.</p>
        </div>
        <div className="website-visitors-stats" aria-label="Visitor stats">
          <span><strong>{sessions.length}</strong> sessions</span>
          <span><strong>{totals.active}</strong> active</span>
          <span><strong>{totals.unread}</strong> unread</span>
          <span><strong>{totals.carts}</strong> carts</span>
        </div>
      </header>

      {error && <div className="website-visitors-alert">{error}</div>}

      <section className="website-visitors-shell">
        <aside className="website-visitors-list-panel">
          <div className="website-visitors-search">
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search visitor, IP, country, page, product"
              type="search"
              value={query}
            />
          </div>

          <div className="website-visitors-list">
            {loadingSessions && sessions.length === 0 ? (
              <div className="website-visitors-empty">Loading visitors...</div>
            ) : sessions.length === 0 ? (
              <div className="website-visitors-empty">No website visitors yet.</div>
            ) : (
              sessions.map((session) => (
                <button
                  className={`website-visitor-row ${session.session_id === selectedSessionId ? "is-active" : ""}`.trim()}
                  key={session.session_id}
                  onClick={() => setSelectedSessionId(session.session_id)}
                  type="button"
                >
                  <span className={`website-visitor-presence ${session.is_active ? "is-online" : ""}`} />
                  <span className="website-visitor-row-main">
                    <strong>{sessionDisplayName(session)}</strong>
                    <small>{cleanPath(session.page_path)} {session.country ? `- ${session.country}` : ""}</small>
                    <em>{session.last_message_preview || session.last_product_name || shortSessionId(session.session_id)}</em>
                  </span>
                  <span className="website-visitor-row-meta">
                    {session.unread_count > 0 && <b>{session.unread_count}</b>}
                    <small>{formatUtcLocal(session.last_message_at || session.last_seen_at || session.created_at)}</small>
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="website-visitors-workspace">
          {selectedSession ? (
            <>
              <section className="website-visitor-summary">
                <div>
                  <span className={`website-visitor-status ${selectedSession.is_active ? "is-online" : ""}`}>
                    {selectedSession.is_active ? "Active now" : "Inactive"}
                  </span>
                  <h2>{sessionDisplayName(selectedSession)}</h2>
                  <p>{selectedSession.visitor_contact || shortSessionId(selectedSession.session_id)}</p>
                </div>
                <dl>
                  <div><dt>IP</dt><dd>{selectedSession.ip_address || "Unknown"}</dd></div>
                  <div><dt>Country</dt><dd>{selectedSession.country || selectedSession.city || "Unknown"}</dd></div>
                  <div><dt>Current page</dt><dd>{cleanPath(selectedSession.page_path)}</dd></div>
                  <div><dt>Last product</dt><dd>{selectedSession.last_product_name || "None"}</dd></div>
                  <div><dt>Cart</dt><dd>{Number(selectedSession.cart_item_count || 0)} items</dd></div>
                  <div><dt>Visits</dt><dd>{Number(selectedSession.page_view_count || 0)} pages</dd></div>
                </dl>
              </section>

              <section className="website-visitors-columns">
                <div className="website-visitor-activity-panel">
                  <div className="website-visitors-section-head">
                    <h3>Activity</h3>
                    <span>{activities.length}</span>
                  </div>
                  <div className="website-visitor-activity-list">
                    {loadingDetail && activities.length === 0 ? (
                      <div className="website-visitors-empty">Loading activity...</div>
                    ) : activities.length === 0 ? (
                      <div className="website-visitors-empty">No activity recorded.</div>
                    ) : (
                      activities.map((activity) => (
                        <article className={`website-visitor-activity is-${activity.event_type || "event"}`} key={activity.id}>
                          <span />
                          <div>
                            <strong>{eventLabels[activity.event_type] || activity.event_type || "Activity"}</strong>
                            <p>{activity.product_name || activity.page_title || cleanPath(activity.page_path)}</p>
                            <small>
                              {formatUtcLocal(activity.created_at)}
                              {Number(activity.cart_item_count || 0) > 0 ? ` - cart ${activity.cart_item_count}` : ""}
                            </small>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </div>

                <div className="website-visitor-chat-panel">
                  <div className="website-visitors-section-head">
                    <h3>Chat</h3>
                    <span>{messages.length}</span>
                  </div>
                  <div className="website-visitor-messages">
                    {loadingDetail && messages.length === 0 ? (
                      <div className="website-visitors-empty">Loading messages...</div>
                    ) : messages.length === 0 ? (
                      <div className="website-visitors-empty">No chat messages yet.</div>
                    ) : (
                      messages.map((message) => (
                        <article
                          className={`website-visitor-message ${message.from_visitor ? "is-visitor" : "is-agent"}`.trim()}
                          key={message.id}
                        >
                          <strong>{message.sender_name || (message.from_visitor ? "Visitor" : "Support")}</strong>
                          <p>{message.body}</p>
                          <small>{formatUtcLocal(message.created_at)}</small>
                        </article>
                      ))
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                  <form className="website-visitor-reply" onSubmit={sendReply}>
                    <textarea
                      disabled={sending}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="Reply to this visitor..."
                      rows={2}
                      value={draft}
                    />
                    <button disabled={!draft.trim() || sending} type="submit">
                      {sending ? "Sending" : "Send reply"}
                    </button>
                  </form>
                </div>
              </section>
            </>
          ) : (
            <div className="website-visitors-empty is-large">Select a website visitor session.</div>
          )}
        </main>
      </section>
    </div>
  );
}

export default WebsiteVisitors;