import { useEffect, useMemo, useRef, useState } from "react";
import awl from "./data/awl.json";

const STORAGE_KEY = "tb-awl-570-progress-v1";
const PEP_TALKS = [
  ["Frequency first", "You have cleared the most useful academic words. That is a serious head start."],
  ["Two lists down", "The language of lectures and essays is already getting easier to recognise."],
  ["Pattern spotted", "You are no longer memorising isolated words. You are seeing how academic English is built."],
  ["Momentum wins", "Four sublists complete. Keep the rhythm and let repetition do the heavy lifting."],
  ["Halfway", "You have crossed the centre of the AWL. The difficult half now looks much smaller."],
  ["Sharper reading", "These words will stop slowing you down and start helping you predict what comes next."],
  ["Seven complete", "You are deep into the list now. This is where consistency starts to look like talent."],
  ["Almost there", "Eight sublists finished. Your academic vocabulary has real range now."],
  ["Final stretch", "Only the last thirty words remain. Finish clean."],
  ["All 570", "You have completed the Academic Word List. Revisit the difficult cards and make the vocabulary yours."]
];

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 10v4h4l5 4V6L8 10H4Z" />
      <path d="M16 9c1.2 1.7 1.2 4.3 0 6M18.8 6.5c2.7 3.1 2.7 7.9 0 11" />
    </svg>
  );
}

function ArrowIcon({ direction = "right" }) {
  return (
    <svg className={direction === "left" ? "is-left" : ""} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14M14 7l5 5-5 5" />
    </svg>
  );
}

function Spark({ className = "" }) {
  return (
    <svg className={`spark ${className}`} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 1.8c1.1 10.9 7.3 17.1 18.2 18.2C27.3 21.1 21.1 27.3 20 38.2 18.9 27.3 12.7 21.1 1.8 20 12.7 18.9 18.9 12.7 20 1.8Z" />
    </svg>
  );
}

function readProgress() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      sublist: Math.min(10, Math.max(1, Number(value.sublist) || 1)),
      index: Math.max(0, Number(value.index) || 0),
      completed: Array.isArray(value.completed) ? value.completed.filter((item) => item >= 1 && item <= 10) : []
    };
  } catch {
    return { sublist: 1, index: 0, completed: [] };
  }
}

function exampleParts(example, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stems = [word, word.replace(/ies$/i, "y"), word.replace(/ing$/i, ""), word.replace(/ed$/i, ""), word.replace(/s$/i, "")]
    .filter((value, index, list) => value.length > 2 && list.indexOf(value) === index)
    .sort((a, b) => b.length - a.length)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const exact = new RegExp(`\\b(${escaped})\\b`, "gi");
  const flexible = new RegExp(`\\b(${stems.join("|")})(?:s|es|ies|ed|d|ing|ly)?\\b`, "gi");
  const pattern = exact.test(example) ? exact : flexible;
  pattern.lastIndex = 0;
  return example.split(pattern);
}

export default function App() {
  const initial = useMemo(readProgress, []);
  const [sublistNumber, setSublistNumber] = useState(initial.sublist);
  const [cardIndex, setCardIndex] = useState(initial.index);
  const [completed, setCompleted] = useState(initial.completed);
  const [flipped, setFlipped] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [packsOpen, setPacksOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [speaking, setSpeaking] = useState("");
  const audioRef = useRef(null);

  const cards = useMemo(() => awl.entries.filter((entry) => entry.sublist === sublistNumber), [sublistNumber]);
  const safeIndex = Math.min(cardIndex, cards.length - 1);
  const card = cards[safeIndex];
  const progress = ((safeIndex + 1) / cards.length) * 100;
  const globalProgress = card?.id || 1;
  const isDense = (card?.definition.length || 0) + (card?.example.length || 0) > 260;

  useEffect(() => {
    if (cardIndex !== safeIndex) setCardIndex(safeIndex);
  }, [cardIndex, safeIndex]);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sublist: sublistNumber, index: safeIndex, completed })
    );
  }, [sublistNumber, safeIndex, completed]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (packsOpen || sourcesOpen) {
        if (event.key === "Escape") {
          setPacksOpen(false);
          setSourcesOpen(false);
        }
        return;
      }
      if (celebrating) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrevious();
      } else if (event.key === " " || event.key === "Enter") {
        if (event.target instanceof HTMLButtonElement) return;
        event.preventDefault();
        setFlipped((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(
    () => () => {
      audioRef.current?.pause();
      speechSynthesis?.cancel();
    },
    []
  );

  function chooseSublist(number) {
    const remembered = number === sublistNumber ? safeIndex : 0;
    setSublistNumber(number);
    setCardIndex(remembered);
    setFlipped(false);
    setCelebrating(false);
    setPacksOpen(false);
  }

  function goPrevious() {
    if (celebrating) {
      setCelebrating(false);
      setFlipped(true);
      return;
    }
    if (safeIndex > 0) {
      setCardIndex((value) => value - 1);
      setFlipped(false);
    } else if (sublistNumber > 1) {
      const priorCards = awl.entries.filter((entry) => entry.sublist === sublistNumber - 1);
      setSublistNumber((value) => value - 1);
      setCardIndex(priorCards.length - 1);
      setFlipped(false);
    }
  }

  function goNext() {
    if (celebrating) {
      continueFromCelebration();
      return;
    }
    if (safeIndex < cards.length - 1) {
      setCardIndex((value) => value + 1);
      setFlipped(false);
      return;
    }
    setCompleted((values) => [...new Set([...values, sublistNumber])].sort((a, b) => a - b));
    setCelebrating(true);
    setFlipped(false);
  }

  function continueFromCelebration() {
    if (sublistNumber < 10) {
      setSublistNumber((value) => value + 1);
      setCardIndex(0);
      setCelebrating(false);
      setFlipped(false);
    } else {
      setSublistNumber(1);
      setCardIndex(0);
      setCelebrating(false);
      setFlipped(false);
    }
  }

  function playPronunciation(accent, event) {
    event.stopPropagation();
    const isUk = accent === "uk";
    const url = isUk ? card.ukAudio : card.usAudio;
    audioRef.current?.pause();
    speechSynthesis?.cancel();
    const audio = new Audio(url);
    audioRef.current = audio;
    setSpeaking(accent);
    const finish = () => setSpeaking("");
    audio.addEventListener("ended", finish, { once: true });
    audio.addEventListener("error", () => {
      const utterance = new SpeechSynthesisUtterance(card.word);
      utterance.lang = isUk ? "en-GB" : "en-US";
      const voices = speechSynthesis.getVoices();
      utterance.voice =
        voices.find((voice) => voice.lang.toLowerCase() === utterance.lang.toLowerCase()) ||
        voices.find((voice) => voice.lang.toLowerCase().startsWith(isUk ? "en-gb" : "en-us")) ||
        null;
      utterance.rate = 0.82;
      utterance.onend = finish;
      utterance.onerror = finish;
      speechSynthesis.speak(utterance);
    }, { once: true });
    audio.play().catch(finish);
  }

  if (!card) return null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => chooseSublist(1)} aria-label="Return to the first sublist">
          <span className="brand-title">AWL 570</span>
          <span className="brand-subtitle">academic word list</span>
        </button>
        <div className="top-actions">
          <button className="quiet-button source-button" onClick={() => setSourcesOpen(true)}>Sources</button>
          <button className="quiet-button browse-button" onClick={() => setPacksOpen(true)}>
            Browse lists
            <span aria-hidden="true">↗</span>
          </button>
        </div>
      </header>

      <main className={`practice ${celebrating ? "is-celebrating" : ""}`}>
        <div className="practice-meta">
          <div className="position">
            <span>sublist {sublistNumber}</span>
            <span aria-hidden="true">/</span>
            <span>card {safeIndex + 1} of {cards.length}</span>
          </div>
          <div className="total-progress">{globalProgress} / 570</div>
        </div>

        <div className="progress-track" aria-label={`${safeIndex + 1} of ${cards.length} cards in sublist ${sublistNumber}`}>
          <span style={{ width: `${progress}%` }} />
        </div>

        <section className={`stage ${celebrating ? "is-celebrating" : ""}`}>
          {celebrating ? (
            <Celebration
              sublist={sublistNumber}
              completed={completed}
              onContinue={continueFromCelebration}
              onReview={() => {
                setCardIndex(0);
                setCelebrating(false);
                setFlipped(false);
              }}
            />
          ) : (
            <>
              <Spark className="spark-left" />
              <Spark className="spark-right" />
              <div
                className={`flashcard ${flipped ? "is-flipped" : ""} ${isDense ? "is-dense" : ""}`}
                onClick={() => setFlipped((value) => !value)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setFlipped((value) => !value);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label={flipped ? `Showing details for ${card.word}. Tap to show the word.` : `${card.word}. Tap to show details.`}
                aria-pressed={flipped}
              >
                <span className="card-rotor">
                  <span className="card-face card-front" aria-hidden={flipped}>
                    <span className="front-kicker">academic word</span>
                    <span className="headword">{card.word}</span>
                    <span className="audio-row">
                      <button
                        type="button"
                        className={`audio-button ${speaking === "uk" ? "is-speaking" : ""}`}
                        onClick={(event) => playPronunciation("uk", event)}
                        aria-label={`Play British pronunciation of ${card.word}`}
                      >
                        <span>UK</span>
                        <SpeakerIcon />
                      </button>
                      <button
                        type="button"
                        className={`audio-button ${speaking === "us" ? "is-speaking" : ""}`}
                        onClick={(event) => playPronunciation("us", event)}
                        aria-label={`Play American pronunciation of ${card.word}`}
                      >
                        <span>US</span>
                        <SpeakerIcon />
                      </button>
                    </span>
                    <span className="flip-hint">tap the card to reveal</span>
                  </span>

                  <span className="card-face card-back" aria-hidden={!flipped}>
                    <span className="back-topline">
                      <span className="back-word">{card.word}</span>
                      <span className="part-of-speech">{card.partOfSpeech || "academic English"}</span>
                    </span>
                    <span className="chinese">{card.chinese}</span>
                    <span className="definition">{card.definition}</span>
                    <span className="detail-block collocation-block">
                      <span className="detail-label">common collocations</span>
                      <span className="collocations">
                        {card.collocations.map((item) => <span key={item}>{item}</span>)}
                      </span>
                    </span>
                    <span className="detail-block example-block">
                      <span className="detail-label">in context</span>
                      <span className="example">
                        {exampleParts(card.example, card.word).map((part, index) =>
                          index % 2 === 1 ? <strong key={`${part}-${index}`}>{part}</strong> : <span key={`${part}-${index}`}>{part}</span>
                        )}
                      </span>
                    </span>
                    <span className="flip-hint">tap to see the word</span>
                  </span>
                </span>
              </div>
            </>
          )}
        </section>

        {!celebrating && (
          <nav className="card-nav" aria-label="Flashcard navigation">
            <button className="nav-button" onClick={goPrevious} disabled={sublistNumber === 1 && safeIndex === 0}>
              <ArrowIcon direction="left" />
              <span>Previous</span>
            </button>
            <button className="nav-button next-button" onClick={goNext}>
              <span>Next</span>
              <ArrowIcon />
            </button>
          </nav>
        )}
      </main>

      <footer className="footer">
        <span>海归湾国际教育</span>
        <button onClick={() => setSourcesOpen(true)}>CC BY-SA learning resource</button>
      </footer>

      {packsOpen && (
        <PackDialog
          current={sublistNumber}
          completed={completed}
          onChoose={chooseSublist}
          onClose={() => setPacksOpen(false)}
        />
      )}
      {sourcesOpen && <SourcesDialog onClose={() => setSourcesOpen(false)} />}
    </div>
  );
}

function Celebration({ sublist, completed, onContinue, onReview }) {
  const allDone = completed.length === 10;
  const [title, message] =
    sublist === 10 && !allDone
      ? ["Sublist ten done", "Finish the remaining lists and then come back to claim all 570."]
      : PEP_TALKS[sublist - 1];
  return (
    <div className="celebration-card" role="status" aria-live="polite">
      <Spark className="celebration-spark one" />
      <Spark className="celebration-spark two" />
      <span className="celebration-kicker">sublist {sublist} complete</span>
      <h1>Congratulations</h1>
      <h2>{title}</h2>
      <p>{message}</p>
      <div className="celebration-stat">
        <strong>{completed.length}</strong>
        <span>of 10 lists complete</span>
      </div>
      <div className="celebration-actions">
        <button className="quiet-button" onClick={onReview}>Review this list</button>
        <button className="primary-button" onClick={onContinue}>
          {sublist === 10 ? (allDone ? "Start again" : "Return to sublist 1") : `Continue to sublist ${sublist + 1}`}
          <ArrowIcon />
        </button>
      </div>
    </div>
  );
}

function PackDialog({ current, completed, onChoose, onClose }) {
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="packs-title" onMouseDown={onClose}>
      <div className="modal packs-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="modal-kicker">all 570 words</span>
            <h2 id="packs-title">Browse sublists</h2>
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="pack-grid">
          {awl.sublists.map((list) => {
            const done = completed.includes(list.number);
            return (
              <button
                key={list.number}
                className={`pack-card ${current === list.number ? "is-current" : ""}`}
                onClick={() => onChoose(list.number)}
              >
                <span className="pack-number">{String(list.number).padStart(2, "0")}</span>
                <span className="pack-copy">
                  <strong>Sublist {list.number}</strong>
                  <span>{list.count} words</span>
                </span>
                <span className={`pack-status ${done ? "is-done" : ""}`}>{done ? "✓" : "→"}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SourcesDialog({ onClose }) {
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="sources-title" onMouseDown={onClose}>
      <div className="modal sources-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="modal-kicker">source notes</span>
            <h2 id="sources-title">Built for serious practice</h2>
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="source-copy">
          <p>
            The word order, plain-English meanings and example sentences come from Simple Wiktionary’s
            Academic Word List pages. That text is available under the Creative Commons Attribution-ShareAlike 4.0 licence.
          </p>
          <p>
            The Academic Word List was developed by Averil Coxhead at Victoria University of Wellington.
            Collocation selections are informed by Longman Dictionary of Contemporary English.
          </p>
          <p>
            Chinese glosses and UK/US pronunciation playback are provided through Youdao dictionary services,
            with a device voice fallback when audio is unavailable.
          </p>
          <div className="source-links">
            <a href="https://simple.wiktionary.org/wiki/Wiktionary:Academic_word_list" target="_blank" rel="noreferrer">Simple Wiktionary ↗</a>
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0 ↗</a>
            <a href="https://www.ldoceonline.com/" target="_blank" rel="noreferrer">Longman ↗</a>
            <a href="https://dict.youdao.com/" target="_blank" rel="noreferrer">Youdao ↗</a>
          </div>
        </div>
      </div>
    </div>
  );
}
