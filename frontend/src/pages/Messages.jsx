import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import api, { getStaticUrl } from "../api/api";
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

function PaperclipIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
      <path
        d="m21.4 11.6-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.3 9.2a2 2 0 1 1-2.8-2.8l8.6-8.6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

const personInitials = (person) =>
  String(person?.name || person?.username || "U")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

const formatFileSize = (value) => {
  const size = Number(value || 0);
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

function Messages() {
  const [people, setPeople] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [conversation, setConversation] = useState([]);
  const [draft, setDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [choosingPerson, setChoosingPerson] = useState(false);
  const [attachment, setAttachment] = useState(null);
  const [loadingPeople, setLoadingPeople] = useState(true);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [error, setError] = useState("");
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const threadBodyRef = useRef(null);
  const fileInputRef = useRef(null);
  const {
    isCallBusy,
    startCall,
  } = useInternalCall();

  const selectedUser = useMemo(
    () => people.find((person) => person.id === selectedUserId) || null,
    [people, selectedUserId]
  );

  const unreadTotal = useMemo(
    () => people.reduce((total, person) => total + Number(person.unread_count || 0), 0),
    [people]
  );



  const filteredPeople = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const candidates = choosingPerson ? people : people.filter((person) => person.last_message_at || Number(person.unread_count) > 0);
    if (!query) return candidates;
    return candidates.filter(
      (person) =>
        (person.name || "").toLowerCase().includes(query) ||
        (person.role || "").toLowerCase().includes(query) ||
        (person.username || "").toLowerCase().includes(query)
    );
  }, [people, searchQuery, choosingPerson]);

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
        if (currentId && nextPeople.some((person) => person.id === currentId)) return currentId;
        return null;
      });
      setError("");
    } catch (loadError) {
      console.error("Messenger users loading error:", loadError);
      setError("Unable to load Messenger contacts.");
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
        setPeople((prevPeople) =>
          prevPeople.map((person) =>
            person.id === selectedUserId ? { ...person, unread_count: 0 } : person
          )
        );
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
    const initialLoadId = window.setTimeout(() => {
      loadPeople();
    }, 0);
    const intervalId = window.setInterval(() => {
      loadPeople();
    }, 60000);
    return () => {
      window.clearTimeout(initialLoadId);
      window.clearInterval(intervalId);
    };
  }, [loadPeople]);



  useEffect(() => {
    const initialLoadId = window.setTimeout(loadConversation, 0);
    if (!selectedUserId) return () => window.clearTimeout(initialLoadId);
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


  const handleAttachmentChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || uploadingAttachment) return;
    const formData = new FormData();
    formData.append("file", file);
    setUploadingAttachment(true);
    setError("");
    try {
      const response = await api.post("/internal-message-attachments", formData);
      setAttachment(response.data || null);
    } catch (uploadError) {
      console.error("Attachment upload error:", uploadError);
      setError(uploadError.response?.data?.detail || "Attachment could not be uploaded.");
    } finally {
      setUploadingAttachment(false);
    }
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    const body = draft.trim();
    if ((!body && !attachment) || !selectedUserId || sending || uploadingAttachment) return;

    setSending(true);
    setError("");
    try {
      await api.post("/internal-messages", {
        recipient_user_id: selectedUserId,
        body,
        attachment_url: attachment?.url || null,
        attachment_name: attachment?.name || null,
        attachment_type: attachment?.type || null,
        attachment_size: attachment?.size || null,
      });
      setDraft("");
      setAttachment(null);
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

  const renderAttachment = (item) => {
    if (!item?.attachment_url) return null;
    const url = getStaticUrl(item.attachment_url);
    const isImage = String(item.attachment_type || "").startsWith("image/");
    return (
      <a
        className={`erp-message-attachment ${isImage ? "is-image" : ""}`.trim()}
        href={url || item.attachment_url}
        rel="noopener noreferrer"
        target="_blank"
      >
        {isImage ? <img alt={item.attachment_name || "Attachment"} src={url || item.attachment_url} /> : <PaperclipIcon />}
        <span>
          <strong>{item.attachment_name || "Attachment"}</strong>
          <small>{formatFileSize(item.attachment_size) || item.attachment_type || "File"}</small>
        </span>
      </a>
    );
  };

  return (
    <div
      className={`erp-messages-page ${
        mobileChatOpen ? "is-mobile-chat-open" : ""
      }`.trim()}
    >
      <div className="erp-messages-topbar">
        <div className="erp-messages-topbar-left">
          <h1 className="erp-messages-topbar-title">Messenger</h1>
          <span className="erp-messages-topbar-status">
            <span className="erp-messages-status-dot" />
            Realtime Connected
          </span>
        </div>
        <div className="erp-messages-topbar-stats">
          <div className="erp-messages-stat-pill">
            Contacts: <strong>{people.length}</strong>
          </div>
          <div className="erp-messages-stat-pill">
            Unread: <strong>{unreadTotal}</strong>
          </div>
        </div>
      </div>
      {error && <div className="erp-messages-alert">{error}</div>}

      {mobileVoiceSetup && (
        <div className="erp-messages-voice-setup" role="alert">
          <div>
            <strong>Microphone calls need the secure mobile link</strong>
            <span>Install the ERP certificate once, close Chrome, then reopen Messenger over HTTPS.</span>
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
            <h2>{choosingPerson ? "New chat" : "Chats"}</h2>
            <button
              type="button"
              className="erp-messages-new-chat"
              aria-label={choosingPerson ? "Back to chats" : "New chat"}
              title={choosingPerson ? "Back to chats" : "New chat"}
              onClick={() => { setChoosingPerson(!choosingPerson); setSearchQuery(""); if (!choosingPerson) loadPeople(); }}
            >{choosingPerson ? <BackIcon /> : "+"}</button>
          </div>

          <div className="erp-messages-search-wrap">
            <input
              className="erp-messages-search-input"
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={choosingPerson ? "Search coworkers..." : "Search chats..."}
              type="text"
              value={searchQuery}
            />
          </div>

          {loadingPeople ? (
            <div className="erp-messages-empty">Loading contacts...</div>
          ) : filteredPeople.length === 0 ? (
            <div className="erp-messages-empty">
              {searchQuery ? "No matches found." : choosingPerson ? "No coworkers are available yet." : "No conversations yet. Tap + to start a chat."}
            </div>
          ) : (
            <div className="erp-messages-person-list">
              {filteredPeople.map((person) => (
                <button
                  className={`erp-messages-person ${
                    person.id === selectedUserId ? "is-active" : ""
                  }`.trim()}
                  key={person.id}
                  onClick={() => {
                    setSelectedUserId(person.id);
                    setChoosingPerson(false);
                    setSearchQuery("");
                    setMobileChatOpen(true);
                  }}
                  type="button"
                >
                  <span className="erp-messages-avatar">
                    {personInitials(person)}
                  </span>
                  <span className="erp-messages-person-copy">
                    <strong>{person.name}</strong>
                    <small>{person.role || "User"}</small>
                  </span>
                  {person.unread_count > 0 && <em>{person.unread_count}</em>}
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
                </div>
              </>
            ) : (
              <div>
                <span>Conversation</span>
                <h2>Select a contact</h2>
                <p>Choose a coworker to send a message or start a call.</p>
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
              <div className="erp-messages-empty">Select a contact to chat.</div>
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
                  {message.body && <p>{message.body}</p>}
                  {renderAttachment(message)}
                  <span>
                    {formatUtcLocal(message.created_at)}
                    {message.is_mine && <strong>{message.read_at ? "Read" : "Sent"}</strong>}
                  </span>
                </article>
              ))
            )}
          </div>

          <form className="erp-messages-compose" onSubmit={sendMessage}>
            <input
              hidden
              onChange={handleAttachmentChange}
              ref={fileInputRef}
              type="file"
            />
            <button
              className="erp-messages-attach-button"
              disabled={!selectedUser || uploadingAttachment}
              onClick={() => fileInputRef.current?.click()}
              title="Attach file"
              type="button"
            >
              <PaperclipIcon />
            </button>
            <div className="erp-messages-compose-main">
              {attachment && (
                <div className="erp-messages-pending-attachment">
                  <PaperclipIcon />
                  <span>
                    <strong>{attachment.name || "Attachment"}</strong>
                    <small>{formatFileSize(attachment.size) || attachment.type || "File"}</small>
                  </span>
                  <button onClick={() => setAttachment(null)} type="button">Remove</button>
                </div>
              )}
              <textarea
                disabled={!selectedUser}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={
                  selectedUser ? `Message ${selectedUser.name}...` : "Select a contact first"
                }
                rows={1}
                value={draft}
              />
            </div>
            <button disabled={!selectedUser || (!draft.trim() && !attachment) || sending || uploadingAttachment} type="submit">
              {uploadingAttachment ? "Uploading" : sending ? "Sending" : "Send"}
            </button>
          </form>
        </main>
      </section>
    </div>
  );
}

export default Messages;
