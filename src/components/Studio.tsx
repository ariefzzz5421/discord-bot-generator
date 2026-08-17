"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_BLUEPRINT,
  commandName,
  type Blueprint,
  type KnowledgeDoc,
} from "@/lib/blueprint";
import { GROUP_LABELS, SKILLS, type SkillGroup } from "@/lib/skills";

type StepId = "brief" | "skills" | "mind" | "knowledge" | "test" | "export";

const STEPS: { id: StepId; label: string }[] = [
  { id: "brief", label: "Brief" },
  { id: "skills", label: "Skills" },
  { id: "mind", label: "Mind" },
  { id: "knowledge", label: "Knowledge" },
  { id: "test", label: "Playground" },
  { id: "export", label: "Export" },
];

const EXAMPLE_BRIEFS = [
  "A support bot for an indie game studio that answers from our FAQ and patch notes, opens tickets for bugs, and escalates anything it can't answer.",
  "A research companion for a machine-learning reading group: it should reason deeply about papers, brainstorm experiment ideas, and summarise threads for people who missed them.",
  "A community bot for a 5,000-member crypto server — welcomes newcomers, runs polls, tracks activity levels, and keeps moderation tight.",
  "A bilingual bot for an Indonesian startup's Discord that translates between English and Bahasa Indonesia and answers product questions from our docs.",
];

interface ChatMessage {
  role: "user" | "bot";
  text: string;
  reasoning?: string;
  hits?: { title: string; score: number; excerpt: string }[];
  source?: "ai" | "fallback";
}

interface PreviewFile {
  path: string;
  content: string;
  lines: number;
  bytes: number;
}

const uid = () => Math.random().toString(36).slice(2, 10);

export default function Studio({ configured }: { configured: boolean }) {
  const [step, setStep] = useState<StepId>("brief");
  const [blueprint, setBlueprint] = useState<Blueprint>(DEFAULT_BLUEPRINT);

  const [brief, setBrief] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patch = useCallback((changes: Partial<Blueprint>) => {
    setBlueprint((current) => ({ ...current, ...changes }));
  }, []);

  // --- step 1: brief -----------------------------------------------------

  async function draft() {
    if (brief.trim().length < 3) {
      setError("Give me a sentence or two to work from.");
      return;
    }
    setDrafting(true);
    setError(null);
    setDraftNote(null);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "The blueprint request failed.");
        return;
      }

      setBlueprint((current) => ({ ...current, ...payload.draft }));
      setDraftNote(payload.note ?? null);
      setStep("skills");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setDrafting(false);
    }
  }

  // --- step 2/3: skills and mind ----------------------------------------

  function toggleSkill(id: string) {
    setBlueprint((current) => {
      const on = current.skills.includes(id);
      const skills = on ? current.skills.filter((s) => s !== id) : [...current.skills, id];

      // Keep the mind flags honest: they describe what the bot can actually do.
      const mind = { ...current.mind };
      if (id === "think-mode") mind.think = !on;
      if (id === "idea-engine") mind.ideas = !on;
      if (id === "rag-knowledge") mind.recall = !on;

      return { ...current, skills, mind };
    });
  }

  // --- step 4: knowledge -------------------------------------------------

  const [docTitle, setDocTitle] = useState("");
  const [docBody, setDocBody] = useState("");

  function addDoc() {
    if (!docTitle.trim() || !docBody.trim()) return;
    const doc: KnowledgeDoc = { id: uid(), title: docTitle.trim(), content: docBody.trim() };
    patch({ knowledge: [...blueprint.knowledge, doc] });
    setDocTitle("");
    setDocBody("");
  }

  function removeDoc(id: string) {
    patch({ knowledge: blueprint.knowledge.filter((doc) => doc.id !== id) });
  }

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    const added: KnowledgeDoc[] = [];

    for (const file of Array.from(files).slice(0, 20)) {
      const text = await file.text();
      if (!text.trim()) continue;
      added.push({
        id: uid(),
        title: file.name.replace(/\.(md|txt|markdown)$/i, ""),
        content: text.trim().slice(0, 200_000),
      });
    }

    if (added.length) patch({ knowledge: [...blueprint.knowledge, ...added] });
  }

  // --- step 5: playground ------------------------------------------------

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<"ask" | "think" | "idea">("ask");
  const [thinking, setThinking] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  async function send() {
    const text = question.trim();
    if (!text || thinking) return;

    setMessages((current) => [...current, { role: "user", text }]);
    setQuestion("");
    setThinking(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blueprint, question: text, mode }),
      });
      const payload = await response.json();

      setMessages((current) => [
        ...current,
        response.ok
          ? {
              role: "bot",
              text: payload.text,
              reasoning: payload.reasoning,
              hits: payload.hits,
              source: payload.source,
            }
          : { role: "bot", text: payload.error ?? "That request failed.", source: "fallback" },
      ]);
    } catch (cause) {
      setMessages((current) => [...current, { role: "bot", text: (cause as Error).message }]);
    } finally {
      setThinking(false);
    }
  }

  // --- step 6: export ----------------------------------------------------

  const [files, setFiles] = useState<PreviewFile[] | null>(null);
  const [activeFile, setActiveFile] = useState<string>("index.js");
  const [downloading, setDownloading] = useState(false);

  const loadPreview = useCallback(async () => {
    try {
      const response = await fetch("/api/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blueprint }),
      });
      const payload = await response.json();
      if (response.ok) setFiles(payload.files);
      else setError(payload.error ?? "Could not build the preview.");
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [blueprint]);

  useEffect(() => {
    if (step === "export") void loadPreview();
  }, [step, loadPreview]);

  async function download() {
    setDownloading(true);
    setError(null);

    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blueprint }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? "The export failed.");
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${blueprint.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-bot.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  // --- derived -----------------------------------------------------------

  const selected = useMemo(
    () => SKILLS.filter((skill) => blueprint.skills.includes(skill.id)),
    [blueprint.skills],
  );

  const commandCount = useMemo(
    () => selected.reduce((sum, skill) => sum + skill.commands.length, 0),
    [selected],
  );

  const knowledgeChars = useMemo(
    () => blueprint.knowledge.reduce((sum, doc) => sum + doc.content.length, 0),
    [blueprint.knowledge],
  );

  const activeContent = files?.find((file) => file.path === activeFile);

  const grouped = (["mind", "community", "utility", "moderation"] as SkillGroup[]).map((group) => ({
    group,
    skills: SKILLS.filter((skill) => skill.group === group),
  }));

  const fileGroups = useMemo(() => {
    if (!files) return [];
    const map = new Map<string, PreviewFile[]>();
    for (const file of files) {
      const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "root";
      if (!map.has(dir)) map.set(dir, []);
      map.get(dir)!.push(file);
    }
    return [...map.entries()].sort(([a], [b]) => (a === "root" ? -1 : b === "root" ? 1 : a.localeCompare(b)));
  }, [files]);

  const goto = (id: StepId) => {
    setError(null);
    setStep(id);
  };

  const index = STEPS.findIndex((s) => s.id === step);
  const next = STEPS[index + 1];
  const previous = STEPS[index - 1];

  return (
    <div className="shell builder">
      <div style={{ minWidth: 0 }}>
        <nav className="steps" aria-label="Build steps">
          {STEPS.map((entry, i) => (
            <button
              key={entry.id}
              className="step"
              data-active={entry.id === step}
              onClick={() => goto(entry.id)}
              type="button"
            >
              <span className="step-num">{String(i + 1).padStart(2, "0")}</span>
              {entry.label}
            </button>
          ))}
        </nav>

        {!configured && (
          <div className="notice notice-warn">
            <span aria-hidden>⚠</span>
            <span>
              <strong>Offline preview mode.</strong> No <code>ANTHROPIC_API_KEY</code> is set, so blueprints
              come from keyword matching and the playground will not produce model replies. Composing skills,
              inspecting the generated code and downloading the ZIP all work normally.
            </span>
          </div>
        )}

        {error && (
          <div className="notice notice-error">
            <span aria-hidden>✕</span>
            <span>{error}</span>
          </div>
        )}

        <section className="card panel">
          {step === "brief" && (
            <>
              <div className="panel-head">
                <h2>Describe your bot</h2>
                <p>
                  Plain language is enough. Claude turns this into a blueprint — name, persona, skills and
                  reasoning settings — which you can then adjust by hand.
                </p>
              </div>

              <div className="field">
                <label className="label" htmlFor="brief">
                  The brief
                </label>
                <textarea
                  id="brief"
                  className="textarea"
                  rows={5}
                  value={brief}
                  placeholder="A support bot for my game studio's Discord. It should answer from our FAQ and patch notes, open a ticket when it can't, and never guess at release dates."
                  onChange={(event) => setBrief(event.target.value)}
                />
                <p className="hint">Mention what it should know, how it should sound, and what it must not do.</p>

                <div className="examples">
                  {EXAMPLE_BRIEFS.map((example, i) => (
                    <button className="example" key={i} type="button" onClick={() => setBrief(example)}>
                      {example.slice(0, 46)}…
                    </button>
                  ))}
                </div>
              </div>

              <div className="panel-actions">
                <button className="btn" type="button" onClick={() => goto("skills")}>
                  Skip, configure by hand
                </button>
                <button className="btn btn-primary" type="button" onClick={draft} disabled={drafting}>
                  {drafting ? (
                    <>
                      <span className="spin" aria-hidden /> Designing…
                    </>
                  ) : (
                    "Draft the blueprint →"
                  )}
                </button>
              </div>
            </>
          )}

          {step === "skills" && (
            <>
              <div className="panel-head">
                <h2>Choose its skills</h2>
                <p>
                  Each skill becomes one file in the generated project. Gateway intents and permissions are
                  wired to match your selection.
                </p>
              </div>

              {draftNote && (
                <div className="notice notice-info">
                  <span aria-hidden>ℹ</span>
                  <span>{draftNote}</span>
                </div>
              )}

              {grouped.map(({ group, skills }) => (
                <div key={group}>
                  <div className="skill-group-label">{GROUP_LABELS[group]}</div>
                  <div className="skill-list">
                    {skills.map((skill) => {
                      const on = blueprint.skills.includes(skill.id);
                      return (
                        <button
                          className="skill"
                          data-on={on}
                          key={skill.id}
                          type="button"
                          onClick={() => toggleSkill(skill.id)}
                          aria-pressed={on}
                        >
                          <span className="skill-emoji" aria-hidden>
                            {skill.emoji}
                          </span>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="skill-name">
                              {skill.name}
                              {skill.usesModel ? <span className="tag-model">AI</span> : null}
                              <span className="skill-check" aria-hidden>
                                ✓
                              </span>
                            </div>
                            <p className="skill-summary">{skill.summary}</p>
                            {skill.commands.length ? (
                              <div className="skill-cmds">
                                {skill.commands.map((cmd) => (
                                  <span className="cmd-chip" key={cmd}>
                                    /{commandName(blueprint, cmd.replace("/", ""))}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div className="panel-actions">
                <span className="hint" style={{ marginTop: 0 }}>
                  {selected.length} skill{selected.length === 1 ? "" : "s"} · {commandCount} command
                  {commandCount === 1 ? "" : "s"}
                </span>
                <span className="spacer" />
                <button className="btn" type="button" onClick={() => goto("brief")}>
                  Back
                </button>
                <button className="btn btn-primary" type="button" onClick={() => goto("mind")}>
                  Next: the mind →
                </button>
              </div>
            </>
          )}

          {step === "mind" && (
            <>
              <div className="panel-head">
                <h2>Shape its mind</h2>
                <p>
                  Identity, voice, and how hard it thinks. The persona becomes the system prompt on every
                  model call.
                </p>
              </div>

              <div className="field field-row">
                <div>
                  <label className="label" htmlFor="name">
                    Name
                  </label>
                  <input
                    id="name"
                    className="input"
                    value={blueprint.name}
                    maxLength={60}
                    onChange={(event) => patch({ name: event.target.value })}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="accent">
                    Accent colour
                  </label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      id="accent"
                      type="color"
                      className="input"
                      style={{ width: 52, padding: 4 }}
                      value={blueprint.accent}
                      onChange={(event) => patch({ accent: event.target.value })}
                    />
                    <input
                      className="input mono-input"
                      value={blueprint.accent}
                      onChange={(event) => patch({ accent: event.target.value })}
                      aria-label="Accent colour hex"
                    />
                  </div>
                </div>
              </div>

              <div className="field">
                <label className="label" htmlFor="tagline">
                  Tagline
                </label>
                <input
                  id="tagline"
                  className="input"
                  value={blueprint.tagline}
                  maxLength={140}
                  onChange={(event) => patch({ tagline: event.target.value })}
                />
                <p className="hint">Shown as the bot&rsquo;s Discord status.</p>
              </div>

              <div className="field">
                <label className="label" htmlFor="persona">
                  Persona (system prompt)
                </label>
                <textarea
                  id="persona"
                  className="textarea"
                  rows={6}
                  value={blueprint.persona}
                  onChange={(event) => patch({ persona: event.target.value })}
                />
                <p className="hint">
                  Address the bot directly. Be specific about what it refuses and how long its answers should
                  be — vague personas produce generic bots.
                </p>
              </div>

              <div className="field">
                <label className="label" htmlFor="namespace">
                  Command namespace (optional)
                </label>
                <input
                  id="namespace"
                  className="input mono-input"
                  value={blueprint.namespace}
                  placeholder="atlas"
                  onChange={(event) =>
                    patch({ namespace: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })
                  }
                />
                <p className="hint">
                  Prefixes every command, so <code>/ask</code> becomes{" "}
                  <code>/{blueprint.namespace || "atlas"}-ask</code>. Useful when several bots share a server.
                </p>
              </div>

              <div className="field">
                <span className="label">Reasoning</span>
                <div className="toggle-list">
                  {(
                    [
                      {
                        key: "think",
                        title: "Deep thinking",
                        desc: "Reason through hard problems at higher effort before answering. Powers /think.",
                      },
                      {
                        key: "ideas",
                        title: "Idea generation",
                        desc: "Divergent brainstorming that produces distinct directions rather than variations.",
                      },
                      {
                        key: "recall",
                        title: "Knowledge recall",
                        desc: "Retrieve from the knowledge base before answering, and cite what was used.",
                      },
                      {
                        key: "memory",
                        title: "Conversation memory",
                        desc: "Remember the last few turns per channel so follow-up questions make sense.",
                      },
                    ] as const
                  ).map((item) => (
                    <button
                      className="toggle"
                      data-on={blueprint.mind[item.key]}
                      key={item.key}
                      type="button"
                      aria-pressed={blueprint.mind[item.key]}
                      onClick={() =>
                        patch({ mind: { ...blueprint.mind, [item.key]: !blueprint.mind[item.key] } })
                      }
                    >
                      <span className="switch" aria-hidden />
                      <span>
                        <span className="toggle-title">{item.title}</span>
                        <span className="toggle-desc">{item.desc}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <span className="label">Effort</span>
                <div className="segmented">
                  {(["low", "medium", "high", "xhigh"] as const).map((level) => (
                    <button
                      className="segment"
                      data-active={blueprint.mind.effort === level}
                      key={level}
                      type="button"
                      onClick={() => patch({ mind: { ...blueprint.mind, effort: level } })}
                    >
                      {level}
                    </button>
                  ))}
                </div>
                <p className="hint">
                  How much the model spends per answer. <code>low</code> for chat, <code>high</code> for
                  research, <code>xhigh</code> for genuinely hard analysis. Adjustable later in{" "}
                  <code>src/core/config.js</code>.
                </p>
              </div>

              <div className="panel-actions">
                <button className="btn" type="button" onClick={() => goto("skills")}>
                  Back
                </button>
                <button className="btn btn-primary" type="button" onClick={() => goto("knowledge")}>
                  Next: knowledge →
                </button>
              </div>
            </>
          )}

          {step === "knowledge" && (
            <>
              <div className="panel-head">
                <h2>Feed it knowledge</h2>
                <p>
                  Documents are chunked on paragraph boundaries and indexed at boot. This is the corpus the
                  bot retrieves from and cites — server rules, product docs, FAQs, past decisions.
                </p>
              </div>

              {!blueprint.mind.recall && (
                <div className="notice notice-warn">
                  <span aria-hidden>⚠</span>
                  <span>
                    Knowledge recall is switched off in the mind step, so these documents will ship with the
                    project but won&rsquo;t be retrieved. Turn recall on to use them.
                  </span>
                </div>
              )}

              <div className="field">
                <label className="label" htmlFor="doc-title">
                  Document title
                </label>
                <input
                  id="doc-title"
                  className="input"
                  value={docTitle}
                  placeholder="Refund policy"
                  onChange={(event) => setDocTitle(event.target.value)}
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="doc-body">
                  Content
                </label>
                <textarea
                  id="doc-body"
                  className="textarea"
                  rows={7}
                  value={docBody}
                  placeholder="Paste the document. Markdown is fine — blank lines become chunk boundaries, so keep paragraphs coherent."
                  onChange={(event) => setDocBody(event.target.value)}
                />
                <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                  <button
                    className="btn btn-sm"
                    type="button"
                    onClick={addDoc}
                    disabled={!docTitle.trim() || !docBody.trim()}
                  >
                    + Add document
                  </button>
                  <label className="btn btn-sm" style={{ cursor: "pointer" }}>
                    Import .md / .txt
                    <input
                      type="file"
                      multiple
                      accept=".md,.txt,.markdown"
                      className="sr-only"
                      onChange={(event) => {
                        void importFiles(event.target.files);
                        event.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </div>

              <div className="field">
                <span className="label">
                  Knowledge base — {blueprint.knowledge.length} document
                  {blueprint.knowledge.length === 1 ? "" : "s"}
                </span>

                {blueprint.knowledge.length === 0 ? (
                  <div className="empty">
                    Nothing yet. A bot with no knowledge base still works — it just answers from the model
                    alone, with no citations.
                  </div>
                ) : (
                  blueprint.knowledge.map((doc) => (
                    <div className="doc" key={doc.id}>
                      <div className="doc-head">
                        <span className="doc-title">{doc.title}</span>
                        <span className="doc-meta">{doc.content.length.toLocaleString()} chars</span>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => removeDoc(doc.id)}>
                          Remove
                        </button>
                      </div>
                      <p className="doc-body">{doc.content}</p>
                    </div>
                  ))
                )}
              </div>

              <div className="panel-actions">
                <button className="btn" type="button" onClick={() => goto("mind")}>
                  Back
                </button>
                <button className="btn btn-primary" type="button" onClick={() => goto("test")}>
                  Next: test it →
                </button>
              </div>
            </>
          )}

          {step === "test" && (
            <>
              <div className="panel-head">
                <h2>Playground</h2>
                <p>
                  The same retriever the bot ships with, running against the documents you just added. What
                  works here works there.
                </p>
              </div>

              <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
                <div className="segmented">
                  {(
                    [
                      { id: "ask", label: "💬 Ask" },
                      { id: "think", label: "🧠 Think" },
                      { id: "idea", label: "💡 Ideas" },
                    ] as const
                  ).map((option) => (
                    <button
                      className="segment"
                      data-active={mode === option.id}
                      key={option.id}
                      type="button"
                      onClick={() => setMode(option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {messages.length > 0 && (
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => setMessages([])}>
                    Clear
                  </button>
                )}
              </div>

              <div className="chat" ref={chatRef}>
                {messages.length === 0 && !thinking && (
                  <div className="empty">
                    Ask {blueprint.name} something. With documents loaded, try a question only your knowledge
                    base could answer — that is the real test of retrieval.
                  </div>
                )}

                {messages.map((message, i) => (
                  <div className={message.role === "user" ? "msg msg-user" : "msg"} key={i}>
                    <span
                      className="avatar"
                      style={
                        message.role === "bot"
                          ? { background: blueprint.accent, borderColor: blueprint.accent, color: "#fff" }
                          : undefined
                      }
                      aria-hidden
                    >
                      {message.role === "bot" ? blueprint.name.slice(0, 1).toUpperCase() : "You"}
                    </span>
                    <div className="bubble">
                      {message.text}

                      {message.reasoning && (
                        <div className="reasoning">
                          <strong>Reasoning summary</strong>
                          {"\n"}
                          {message.reasoning}
                        </div>
                      )}

                      {message.role === "bot" && message.hits && message.hits.length > 0 && (
                        <div className="bubble-meta">
                          Retrieved{" "}
                          {message.hits.map((hit, index) => (
                            <span key={index}>
                              {index > 0 ? " · " : ""}
                              <code>
                                [{index + 1}] {hit.title}
                              </code>{" "}
                              ({hit.score})
                            </span>
                          ))}
                        </div>
                      )}

                      {message.role === "bot" && message.hits?.length === 0 && blueprint.mind.recall && (
                        <div className="bubble-meta">Retrieved nothing — no document matched this question.</div>
                      )}
                    </div>
                  </div>
                ))}

                {thinking && (
                  <div className="msg">
                    <span
                      className="avatar"
                      style={{ background: blueprint.accent, borderColor: blueprint.accent, color: "#fff" }}
                      aria-hidden
                    >
                      {blueprint.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="bubble">
                      <span className="typing" aria-label="Thinking">
                        <span />
                        <span />
                        <span />
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="composer">
                <textarea
                  className="textarea"
                  rows={2}
                  style={{ minHeight: 0 }}
                  value={question}
                  placeholder={`Ask ${blueprint.name} something…`}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />
                <button className="btn btn-primary" type="button" onClick={send} disabled={thinking || !question.trim()}>
                  Send
                </button>
              </div>
              <p className="hint">Enter to send, Shift+Enter for a new line.</p>

              <div className="panel-actions">
                <button className="btn" type="button" onClick={() => goto("knowledge")}>
                  Back
                </button>
                <button className="btn btn-primary" type="button" onClick={() => goto("export")}>
                  Next: export →
                </button>
              </div>
            </>
          )}

          {step === "export" && (
            <>
              <div className="panel-head">
                <h2>Your bot, as code</h2>
                <p>
                  Every file that goes in the ZIP, exactly as it will land on disk. Read it before you run it.
                </p>
              </div>

              {!files ? (
                <div className="empty">
                  <span className="spin" style={{ display: "inline-block", verticalAlign: "middle" }} aria-hidden />{" "}
                  Generating the project…
                </div>
              ) : (
                <>
                  <div className="file-browser">
                    <div className="file-list">
                      {fileGroups.map(([dir, entries]) => (
                        <div key={dir}>
                          <div className="file-dir">{dir === "root" ? "/" : `${dir}/`}</div>
                          {entries.map((file) => (
                            <button
                              className="file-item"
                              data-active={file.path === activeFile}
                              key={file.path}
                              type="button"
                              onClick={() => setActiveFile(file.path)}
                            >
                              {file.path.split("/").pop()}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>

                    <div className="code-pane">
                      <div className="code-head">
                        <span style={{ color: "var(--text)" }}>{activeFile}</span>
                        <span className="spacer" />
                        {activeContent && (
                          <>
                            <span>{activeContent.lines} lines</span>
                            <button
                              className="btn btn-ghost btn-sm"
                              type="button"
                              onClick={() => void navigator.clipboard?.writeText(activeContent.content)}
                            >
                              Copy
                            </button>
                          </>
                        )}
                      </div>
                      <pre className="code-body">
                        <code>{activeContent?.content ?? "Select a file."}</code>
                      </pre>
                    </div>
                  </div>

                  <div
                    className="notice notice-info"
                    style={{ marginTop: 18, marginBottom: 0, display: "block" }}
                  >
                    <strong>After downloading:</strong>
                    <pre
                      style={{
                        margin: "10px 0 0",
                        fontSize: 12.5,
                        color: "var(--text)",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {`unzip ${blueprint.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-bot.zip\ncd ${blueprint.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}\nnpm install\ncp .env.example .env   # add DISCORD_TOKEN, CLIENT_ID, GUILD_ID, ANTHROPIC_API_KEY\nnpm run deploy         # register slash commands\nnpm start`}
                    </pre>
                  </div>
                </>
              )}

              <div className="panel-actions">
                <span className="hint" style={{ marginTop: 0 }}>
                  {files ? `${files.length} files` : "…"}
                </span>
                <span className="spacer" />
                <button className="btn" type="button" onClick={() => goto("test")}>
                  Back
                </button>
                <button className="btn btn-primary" type="button" onClick={download} disabled={downloading}>
                  {downloading ? (
                    <>
                      <span className="spin" aria-hidden /> Packaging…
                    </>
                  ) : (
                    "↓ Download ZIP"
                  )}
                </button>
              </div>
            </>
          )}
        </section>

        {next && step !== "export" && (
          <p className="hint" style={{ textAlign: "right", marginTop: 12 }}>
            Next: {next.label}
            {previous ? ` · Previous: ${previous.label}` : ""}
          </p>
        )}
      </div>

      <aside className="side">
        <div className="card side-card">
          <div className="side-title">
            Blueprint
            <span className="dot" aria-hidden />
          </div>

          <div className="bot-identity">
            <div className="bot-avatar" style={{ background: blueprint.accent }} aria-hidden>
              {blueprint.name.slice(0, 1).toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="bot-name">{blueprint.name}</div>
              <div className="bot-tag">{blueprint.tagline}</div>
            </div>
          </div>

          <div className="stat-row">
            <span className="stat-key">Skills</span>
            <span className="stat-val">{selected.length}</span>
          </div>
          <div className="stat-row">
            <span className="stat-key">Commands</span>
            <span className="stat-val">{commandCount}</span>
          </div>
          <div className="stat-row">
            <span className="stat-key">Knowledge</span>
            <span className="stat-val">
              {blueprint.knowledge.length} doc · {(knowledgeChars / 1000).toFixed(1)}k chars
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-key">Effort</span>
            <span className="stat-val">{blueprint.mind.effort}</span>
          </div>
          <div className="stat-row">
            <span className="stat-key">Mind</span>
            <span className="stat-val">
              {(["think", "ideas", "recall", "memory"] as const).filter((key) => blueprint.mind[key]).join(" · ") ||
                "—"}
            </span>
          </div>
        </div>

        <div className="card side-card">
          <div className="side-title">Enabled skills</div>
          {selected.length === 0 ? (
            <p className="hint" style={{ marginTop: 0 }}>
              None selected. The bot will start and connect, but it will not respond to anything.
            </p>
          ) : (
            <div className="chip-row">
              {selected.map((skill) => (
                <span className="chip" key={skill.id}>
                  {skill.emoji} {skill.name}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="card side-card">
          <div className="side-title">Quick actions</div>
          <div style={{ display: "grid", gap: 8 }}>
            <button className="btn btn-sm" type="button" onClick={() => goto("test")}>
              🧪 Test in playground
            </button>
            <button className="btn btn-sm" type="button" onClick={() => goto("export")}>
              📄 Inspect the code
            </button>
            <button className="btn btn-primary btn-sm" type="button" onClick={download} disabled={downloading}>
              {downloading ? "Packaging…" : "↓ Download ZIP"}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
