import { useMemo, useState } from "react";
import { useConfirmDialog } from "../components/DialogProvider";
import { useWorkspaceData } from "../utils/workspaceData";
import "./Quotes.css";

const STORAGE_KEY = "dashboardQuotes";
const INTERVAL_STORAGE_KEY = "dashboardQuoteInterval";
const DEFAULT_INTERVAL = 15;
const INTERVAL_OPTIONS = [5, 10, 15, 30, 60];

const DEFAULT_QUOTES = [
  "Dream Big. Work Hard. Stay Humble.",
  "Success Starts with Self-Belief.",
  "Your Future Is Created by What You Do Today.",
  "Don't Watch the Clock. Do What It Does - Keep Going.",
  "Every Day Is a Fresh Opportunity to Grow.",
  "The Best Time to Start Was Yesterday. The Next Best Time Is Now.",
  "Great Things Never Come from Comfort Zones.",
  "Stay Focused on the Goal, Not the Obstacles.",
  "Success Is the Sum of Small Efforts Repeated Daily.",
  "Believe in the Process. Trust the Results.",
  "The Harder You Work, the Luckier You Get.",
  "Progress, Not Perfection.",
  "Every Accomplishment Begins with the Decision to Try.",
  "Difficult Roads Often Lead to Beautiful Destinations.",
  "Be Better Than You Were Yesterday.",
  "Consistency Turns Dreams into Reality.",
  "Your Only Limit Is the One You Refuse to Challenge.",
  "Winners Focus on Progress, Not Excuses.",
  "A Little Progress Each Day Adds Up to Big Results.",
  "Success Is Earned One Day at a Time.",
];

const normalizeQuoteData = (data) => ({
  interval: Number(data?.interval) > 0 ? Number(data.interval) : DEFAULT_INTERVAL,
  quotes: Array.isArray(data?.quotes) ? data.quotes : [...DEFAULT_QUOTES],
});

const loadQuoteData = () => {
  if (typeof window === "undefined") {
    return { data: normalizeQuoteData(null), exists: false };
  }

  const storedQuotes = window.localStorage.getItem(STORAGE_KEY);
  const storedInterval = window.localStorage.getItem(INTERVAL_STORAGE_KEY);
  let quotes = [...DEFAULT_QUOTES];

  if (storedQuotes) {
    try {
      const parsed = JSON.parse(storedQuotes);
      if (Array.isArray(parsed)) quotes = parsed;
    } catch (error) {
      console.error("Failed to load quotes from storage", error);
    }
  }

  return {
    data: normalizeQuoteData({
      interval: Number(storedInterval),
      quotes,
    }),
    exists: storedQuotes !== null || storedInterval !== null,
  };
};

const saveQuoteDataLocally = (data) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data.quotes));
  window.localStorage.setItem(INTERVAL_STORAGE_KEY, String(data.interval));
};

const getNextChangeTime = (intervalMinutes) => {
  const now = new Date();
  const intervalMs = intervalMinutes * 60 * 1000;
  const elapsed = now.getTime() % intervalMs;
  return new Date(now.getTime() + (intervalMs - elapsed));
};

function Quotes() {
  const confirmDialog = useConfirmDialog();
  const [quoteData, setQuoteData, syncStatus] = useWorkspaceData({
    dataKey: "quotes",
    loadLocal: loadQuoteData,
    normalize: normalizeQuoteData,
    saveLocal: saveQuoteDataLocally,
  });
  const { interval, quotes } = quoteData;
  const [newQuote, setNewQuote] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSummary, setShowSummary] = useState(false);

  const nextChangeTime = useMemo(() => getNextChangeTime(interval), [interval]);

  const filteredQuotes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const indexedQuotes = quotes.map((quote, index) => ({ index, quote }));
    if (!query) return indexedQuotes;

    return indexedQuotes.filter(({ quote }) => String(quote).toLowerCase().includes(query));
  }, [quotes, searchQuery]);

  const stats = useMemo(
    () => ({
      defaults: DEFAULT_QUOTES.length,
      interval,
      total: quotes.length,
      visible: filteredQuotes.length,
    }),
    [filteredQuotes.length, interval, quotes.length]
  );

  const handleAddQuote = () => {
    const value = newQuote.trim();
    if (!value) return;

    setQuoteData((current) => ({
      ...current,
      quotes: [value, ...current.quotes],
    }));
    setNewQuote("");
  };

  const handleIntervalChange = (value) => {
    setQuoteData((current) => ({ ...current, interval: value }));
  };

  const handleRemoveQuote = (index) => {
    setQuoteData((current) => ({
      ...current,
      quotes: current.quotes.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const handleResetDefaults = async () => {
    const confirmed = await confirmDialog({
      title: "Reset quotes?",
      message: "Reset dashboard quotes to defaults?",
      tone: "warning",
      confirmText: "Reset quotes",
    });
    if (!confirmed) return;
    setQuoteData((current) => ({ ...current, quotes: [...DEFAULT_QUOTES] }));
    setSearchQuery("");
  };

  return (
    <div className="quotes-page">
      <header className={`quotes-header ${showSummary ? "is-expanded" : ""}`}>
        <div>
          <span className="quotes-kicker">Dashboard content</span>
          <h1>Dashboard Quotes</h1>
          <p>
            Manage the motivational quote rotation shown on the ERP dashboard.{" "}
            {syncStatus === "local"
              ? "Database reconnect pending."
              : syncStatus === "synced"
                ? "Stored in the ERP database."
                : "Saving to the ERP database."}
          </p>
        </div>

        <div className="quotes-header-actions">
          <button
            aria-controls="quotes-header-summary"
            aria-expanded={showSummary}
            className="overview-header-toggle"
            onClick={() => setShowSummary((current) => !current)}
            type="button"
          >
            Overview
            <span aria-hidden="true" className="overview-toggle-chevron" />
          </button>
        </div>

        {showSummary && (
        <section
          className="quotes-summary"
          aria-label="Quotes summary"
          id="quotes-header-summary"
        >
          <article>
            <span>Quotes</span>
            <strong>{stats.total}</strong>
          </article>
          <article>
            <span>Showing</span>
            <strong>{stats.visible}</strong>
          </article>
          <article>
            <span>Interval</span>
            <strong>{stats.interval}m</strong>
          </article>
          <article>
            <span>Defaults</span>
            <strong>{stats.defaults}</strong>
          </article>
        </section>
        )}
      </header>

      <section className="quotes-editor">
        <div className="quotes-settings">
          <label className="quotes-field">
            <span>Rotation interval</span>
            <select
              onChange={(event) => handleIntervalChange(Number(event.target.value))}
              value={interval}
            >
              {INTERVAL_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option} minutes
                </option>
              ))}
            </select>
          </label>

          <div className="quotes-next-change">
            <span>Next change</span>
            <strong>
              {nextChangeTime.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </strong>
          </div>
        </div>

        <div className="quotes-add-panel">
          <label className="quotes-field">
            <span>New quote</span>
            <textarea
              onChange={(event) => setNewQuote(event.target.value)}
              placeholder="Add a new dashboard quote"
              rows={3}
              value={newQuote}
            />
          </label>
          <div className="quotes-actions">
            <button className="quotes-primary-button" onClick={handleAddQuote} type="button">
              Add quote
            </button>
            <button
              className="quotes-secondary-button"
              disabled={!newQuote.trim()}
              onClick={() => setNewQuote("")}
              type="button"
            >
              Clear
            </button>
          </div>
        </div>
      </section>

      <section className="quotes-list-section">
        <div className="quotes-list-toolbar">
          <div>
            <h2>Quote List</h2>
            <p>Review and refine the dashboard rotation.</p>
          </div>
          <div className="quotes-list-controls">
            <label className="quotes-search">
              <span>Search</span>
              <input
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Find a quote"
                type="search"
                value={searchQuery}
              />
            </label>
            <button className="quotes-secondary-button" onClick={handleResetDefaults} type="button">
              Reset defaults
            </button>
          </div>
        </div>

        {filteredQuotes.length === 0 ? (
          <div className="quotes-empty-state">
            <strong>{quotes.length ? "No matching quotes" : "No quotes saved"}</strong>
            <span>
              {quotes.length
                ? "Try another search term."
                : "Add a quote or reset to the default dashboard list."}
            </span>
          </div>
        ) : (
          <div className="quotes-list">
            {filteredQuotes.map(({ index, quote }) => (
              <article className="quotes-list-item" key={`${quote}-${index}`}>
                <div className="quotes-list-index">{index + 1}</div>
                <p>{quote}</p>
                <button
                  className="quotes-danger-button"
                  onClick={() => handleRemoveQuote(index)}
                  type="button"
                >
                  Delete
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default Quotes;
