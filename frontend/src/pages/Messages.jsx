import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import api from "../api/api";
import { subscribeRealtime } from "../api/realtime";
import { useInternalCall } from "../components/InternalCallContext";
import { formatUtcLocal } from "../utils/dateUtils";
import "./MessagesChat.css";

function PhoneIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
      <path
        d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.7 2.6a2 2 0 0 1-.5 2.1L9 10.7a16 16 0 0 0 4.3 4.3l1.3-1.3a2 2 0 0 1 2.1-.5c.8.4 1.7.6 2.6.7a2 2 0 0 1 1.7 2Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
      <path
        d="M15 10 20.5 7v10L15 14M5 5h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="22" viewBox="0 0 24 24" width="22">
      <path
        d="m15 18-6-6 6-6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.4"
      />
    </svg>
  );
}

function Messages() {
  const [people, setPeople] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [conversation, setConversation] = useState([]);
  const [draft, setDraft] = useState("");
  const [loadingPeople, setLoadingPeople] = useState(true);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const threadBodyRef = useRef(null);
  const {
    isCallBusy,
    isVideoCallingEnabled,
    startCall,
    startVideoCall,
  } = useInternalCall();

  const selectedUser = useMemo(
    () => people.find((person) => person.id === selectedUserId) || null,
    [people, selectedUserId]
  );

  const mobileVoiceSetup = useMemo(() => {
    if (typeof window === "undefined" || window.isSecureContext) return null;
    const host = window.location.hostname;
    return {
      certificateUrl: `http://${host}:8000/static/hisbenew-erp-mobile.cer`,
      secureUrl: `https://${host}:5173/portal/messages`,
    };
  }, []);

  const loadPeople = useCallback(async () => {
    try {
      const response = await api.get("/internal-message-users");
      const nextPeople = Array.isArray(response.data) ? response.data : [];
      setPeople(nextPeople);
      setSelectedUserId((currentId) => {
        if (currentId && nextPeople.some((person) => person.id === currentId)) {
          return currentId;
        }
        return nextPeople[0]?.id || null;
      });
    } catch (loadError) {
      console.error("Message users loading error:", loadError);
      setError("Unable to load ERP users.");
    } finally {
      setLoadingPeople(false);
    }
  }, []);

  const loadConversation = useCallback(
    async ({ quiet = false } = {}) => {
      if (!selectedUserId) {
        setConversation([]);
        return;
      }

      if (!quiet) setLoadingConversation(true);
      try {
        const response = await api.get("/internal-messages", {
          params: { user_id: selectedUserId },
        });
        setConversation(Array.isArray(response.data) ? response.data : []);
        setError("");
      } catch (loadError) {
        console.error("Conversation loading error:", loadError);
        setError("Unable to load this conversation.");
      } finally {
        setLoadingConversation(false);
      }
    },
    [selectedUserId]
  );

  useEffect(() => {
    const initialLoadId = window.setTimeout(loadPeople, 0);
    const intervalId = window.setInterval(loadPeople, 60000);
    return () => {
      window.clearTimeout(initialLoadId);
      window.clearInterval(intervalId);
    };
  }, [loadPeople]);

  useEffect(() => {
    const initialLoadId = window.setTimeout(loadConversation, 0);
    if (!selectedUserId) {
      return () => window.clearTimeout(initialLoadId);
    }
    const intervalId = window.setInterval(
      () => loadConversation({ quiet: true }),
      60000
    );
    return () => {
      window.clearTimeout(initialLoadId);
      window.clearInterval(intervalId);
    };
  }, [loadConversation, selectedUserId]);

  useEffect(
    () =>
      subscribeRealtime((event) => {
        if (event?.type !== "message.created" || !event.message) return;
        const message = event.message;
        const otherUserId = message.is_mine
          ? message.recipient_user_id
          : message.sender_user_id;
        loadPeople();
        if (otherUserId === selectedUserId) {
          loadConversation({ quiet: true });
        }
      }),
    [loadConversation, loadPeople, selectedUserId]
  );

  useLayoutEffect(() => {
    if (loadingConversation || !selectedUserId) return undefined;
    const animationFrame = window.requestAnimationFrame(() => {
      const threadBody = threadBodyRef.current;
      if (threadBody) threadBody.scrollTop = threadBody.scrollHeight;
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [conversation.length, loadingConversation, selectedUserId]);

  const sendMessage = async (event) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !selectedUserId || sending) return;

    setSending(true);
    setError("");
    try {
      await api.post("/internal-messages", {
        recipient_user_id: selectedUserId,
        body,
      });
      setDraft("");
      await loadConversation({ quiet: true });
      await loadPeople();
    } catch (sendError) {
      console.error("Send message error:", sendError);
      setError(sendError.response?.data?.detail || "Message could not be sent.");
    } finally {
      setSending(false);
    }
  };

  const handleComposerKeyDown = (event) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <div
      className={`erp-messages-page ${
        mobileChatOpen ? "is-mobile-chat-open" : ""
      }`.trim()}
    >
      <header className="erp-messages-header">
        <div>
          <span>Team communication</span>
          <h1>Messages</h1>
          <p>Send ERP messages to workers, managers, warehouse users, and admins.</p>
        </div>
      </header>

      {error && <div className="erp-messages-alert">{error}</div>}

      {mobileVoiceSetup && (
        <div className="erp-messages-voice-setup" role="alert">
          <div>
            <strong>Microphone calls need the secure mobile link</strong>
            <span>Install the ERP certificate once, close Chrome, then reopen Messages over HTTPS.</span>
          </div>
          <a href={mobileVoiceSetup.certificateUrl}>Install certificate</a>
          <a href={mobileVoiceSetup.secureUrl}>Open secure ERP</a>
        </div>
      )}

      <section
        className={`erp-messages-shell ${
          mobileChatOpen ? "is-mobile-chat-open" : ""
        }`.trim()}
      >
        <aside className="erp-messages-people">
          <div className="erp-messages-people-head">
            <h2>People</h2>
            <span>{people.length}</span>
          </div>

          {loadingPeople ? (
            <div className="erp-messages-empty">Loading people...</div>
          ) : people.length === 0 ? (
            <div className="erp-messages-empty">No other active users found.</div>
          ) : (
            <div className="erp-messages-person-list">
              {people.map((person) => (
                <button
                  className={`erp-messages-person ${
                    person.id === selectedUserId ? "is-active" : ""
                  }`.trim()}
                  key={person.id}
                  onClick={() => {
                    setSelectedUserId(person.id);
                    setMobileChatOpen(true);
                  }}
                  type="button"
                >
                  <span className="erp-messages-avatar">
                    {String(person.name || "U")
                      .split(/\s+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((part) => part[0])
                      .join("")
                      .toUpperCase()}
                  </span>
                  <span className="erp-messages-person-copy">
                    <strong>{person.name}</strong>
                    <small>{person.role || "User"}</small>
                  </span>
                  {person.unread_count > 0 && (
                    <em>{person.unread_count}</em>
                  )}
                </button>
              ))}
            </div>
          )}
        </aside>

        <main className="erp-messages-thread">
          <div className="erp-messages-thread-head">
            {selectedUser ? (
              <>
                <button
                  aria-label="Back to people"
                  className="erp-messages-mobile-back"
                  onClick={() => setMobileChatOpen(false)}
                  type="button"
                >
                  <BackIcon />
                </button>
                <div>
                  <span>Conversation</span>
                  <h2>{selectedUser.name}</h2>
                  <p>{selectedUser.username || selectedUser.role || "ERP user"}</p>
                </div>
                <div className="erp-messages-call-actions">
                  <button
                    aria-label={`Start voice call with ${selectedUser.name}`}
                    className="erp-messages-call-button"
                    disabled={isCallBusy}
                    onClick={() => startCall(selectedUser)}
                    title={isCallBusy ? "Finish the current call first" : `Call ${selectedUser.name}`}
                    type="button"
                  >
                    <PhoneIcon />
                    <span>Call</span>
                  </button>
                  {isVideoCallingEnabled && (
                    <button
                      aria-label={`Start video call with ${selectedUser.name}`}
                      className="erp-messages-call-button is-video"
                      disabled={isCallBusy}
                      onClick={() => startVideoCall(selectedUser)}
                      title={isCallBusy ? "Finish the current call first" : `Video call ${selectedUser.name}`}
                      type="button"
                    >
                      <VideoIcon />
                      <span>Video</span>
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div>
                <span>Conversation</span>
                <h2>Select a person</h2>
                <p>Choose a user to start messaging.</p>
              </div>
            )}
          </div>

          <div
            aria-live="polite"
            className="erp-messages-thread-body"
            ref={threadBodyRef}
          >
            {loadingConversation ? (
              <div className="erp-messages-empty">Loading messages...</div>
            ) : !selectedUser ? (
              <div className="erp-messages-empty">Select a person to chat.</div>
            ) : conversation.length === 0 ? (
              <div className="erp-messages-empty">
                No messages yet. Send the first one.
              </div>
            ) : (
              conversation.map((message) => (
                <article
                  className={`erp-message-bubble ${
                    message.is_mine ? "is-mine" : "is-theirs"
                  }`.trim()}
                  key={message.id}
                >
                  <p>{message.body}</p>
                  <span>
                    {formatUtcLocal(message.created_at)}
                    {message.is_mine && (
                      <strong>{message.read_at ? "Read" : "Sent"}</strong>
                    )}
                  </span>
                </article>
              ))
            )}
          </div>

          <form className="erp-messages-compose" onSubmit={sendMessage}>
            <textarea
              disabled={!selectedUser}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={
                selectedUser ? `Message ${selectedUser.name}` : "Select a person first"
              }
              rows={1}
              value={draft}
            />
            <button disabled={!selectedUser || !draft.trim() || sending} type="submit">
              {sending ? "Sending..." : "Send"}
            </button>
          </form>
        </main>
      </section>
    </div>
  );
}

export default Messages;
