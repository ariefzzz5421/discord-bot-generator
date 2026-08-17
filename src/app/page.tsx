import Link from "next/link";
import { GROUP_LABELS, SKILLS, type SkillGroup } from "@/lib/skills";
import { apiKeyPresent } from "@/lib/ai";

const FEATURES = [
  {
    icon: "🧠",
    title: "A mind, not a command list",
    body: "Think mode reasons at higher effort before answering. Idea mode generates genuinely different directions instead of five rewordings of one. Both ship as slash commands.",
  },
  {
    icon: "📚",
    title: "RAG that runs in your bot",
    body: "Documents are chunked and indexed at boot. Retrieval is BM25 out of the box, blended with embeddings when you add a key — and answers cite the passages they used.",
  },
  {
    icon: "🎛️",
    title: "Skills you compose",
    body: "Thirteen skills across mind, community, utility and moderation. Pick what the server needs; the generator wires intents, permissions and command registration to match.",
  },
  {
    icon: "📦",
    title: "Real code, no lock-in",
    body: "You download a plain discord.js v14 project — readable files, no proprietary runtime, no hosted dependency on this tool. Read it, edit it, deploy it anywhere.",
  },
  {
    icon: "🧪",
    title: "Test before you download",
    body: "The playground runs the same retriever the bot will use, against the same documents. What passes here is what ships.",
  },
  {
    icon: "🔌",
    title: "Extensible by design",
    body: "One file per skill and a registry to list it in. Adding your own is a twenty-line module — the generated README walks through it.",
  },
];

const STEPS = [
  { title: "Describe it", body: "One or two sentences about the bot you want. Claude drafts a blueprint: persona, skills, reasoning settings." },
  { title: "Tune the skills", body: "Toggle capabilities and adjust the mind. Every change updates the file tree on the right." },
  { title: "Feed it knowledge", body: "Paste docs, rules, FAQs. They become the retrieval corpus your bot answers from." },
  { title: "Test, then download", body: "Chat with it in the playground, then take the ZIP. npm install, npm run deploy, npm start." },
];

export default function LandingPage() {
  const configured = apiKeyPresent();

  const grouped = (["mind", "community", "utility", "moderation"] as SkillGroup[]).map((group) => ({
    group,
    skills: SKILLS.filter((s) => s.group === group),
  }));

  return (
    <>
      <section className="shell hero">
        <span className="pill">
          <span className={configured ? "dot" : "dot dot-warn"} aria-hidden />
          {configured ? "Claude connected · claude-opus-5" : "Running in offline preview mode"}
        </span>

        <h1>
          Forge a Discord bot <span className="gradient-text">with a mind of its own</span>
        </h1>

        <p className="hero-sub">
          Describe what you want in plain language. Pick the skills it should have. Give it documents to
          reason over. Download a complete discord.js project that thinks, brainstorms, and answers from
          your knowledge base with citations.
        </p>

        <div className="hero-actions">
          <Link href="/builder" className="btn btn-primary btn-lg">
            Start building →
          </Link>
          <Link href="#skills" className="btn btn-lg">
            Browse the skills
          </Link>
        </div>
      </section>

      <section className="shell section" id="how">
        <div className="section-head">
          <h2>Four steps, then it&rsquo;s yours</h2>
          <p>
            No account, no deploy step, nothing running on our side once you have the ZIP. The generator
            hands you source code.
          </p>
        </div>
        <div className="flow">
          {STEPS.map((step) => (
            <div className="flow-step" key={step.title}>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="shell section">
        <div className="section-head">
          <h2>What makes these bots different</h2>
          <p>
            Most generators emit a command scaffold. This one emits a reasoning loop, a retriever, and
            per-channel memory — the parts that make a bot feel like it belongs in the server.
          </p>
        </div>
        <div className="grid grid-3">
          {FEATURES.map((feature) => (
            <article className="card feature" key={feature.title}>
              <div className="feature-icon" aria-hidden>
                {feature.icon}
              </div>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="shell section" id="skills">
        <div className="section-head">
          <h2>The skill library</h2>
          <p>
            {SKILLS.length} skills. Each one is a single generated file you can read and change. Commands
            shown unnamespaced — the builder can prefix them if you run several bots in one server.
          </p>
        </div>

        {grouped.map(({ group, skills }) => (
          <div key={group}>
            <div className="skill-group-label">{GROUP_LABELS[group]}</div>
            <div className="skill-list">
              {skills.map((skill) => (
                <article className="skill" style={{ cursor: "default" }} key={skill.id}>
                  <span className="skill-emoji" aria-hidden>
                    {skill.emoji}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="skill-name">
                      {skill.name}
                      {skill.usesModel ? <span className="tag-model">AI</span> : null}
                    </div>
                    <p className="skill-summary">{skill.summary}</p>
                    {skill.commands.length ? (
                      <div className="skill-cmds">
                        {skill.commands.map((cmd) => (
                          <span className="cmd-chip" key={cmd}>
                            {cmd}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="shell section">
        <div
          className="card"
          style={{
            padding: "40px 32px",
            textAlign: "center",
            background:
              "linear-gradient(140deg, rgba(124,92,255,0.14), rgba(53,230,208,0.06) 70%, transparent)",
          }}
        >
          <h2 style={{ fontSize: 28, marginBottom: 12 }}>Ready when you are</h2>
          <p style={{ color: "var(--text-dim)", maxWidth: "52ch", margin: "0 auto 26px" }}>
            The studio works without credentials — you can compose a bot, inspect every generated file and
            download the ZIP. Add an Anthropic key to have Claude draft the blueprint and to chat with your
            bot before shipping it.
          </p>
          <Link href="/builder" className="btn btn-primary btn-lg">
            Open the studio →
          </Link>
        </div>
      </section>
    </>
  );
}
