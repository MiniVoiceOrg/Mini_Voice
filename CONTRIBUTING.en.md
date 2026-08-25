# Contributing to Monky

*[Português](CONTRIBUTING.md) · **English***

Thanks for your interest! This document explains how to propose ideas, vote on
what comes first and — if you want to write code — how to open a PR that lands
without friction.

Monky is MIT and development happens entirely in public, in the
[Issues](https://github.com/MonkyOrg/Monky/issues).

---

## 🗳️ The easiest way to help: say what you want

You **do not need to know how to code** to influence where the project goes.
What goes into each cycle is decided by community votes.

### Proposing an idea

Open a discussion under
**[Discussions › Ideas](https://github.com/MonkyOrg/Monky/discussions/categories/ideas)**.

Two rules that make voting work:

1. **Search before posting.** If the idea already exists, vote on it instead of
   opening another — two identical proposals split the votes and both lose.
2. **One idea per discussion.** In a list of five requests, nobody can say they
   agree with the third and disagree with the fifth.

### Voting

Use the discussion's **upvote button** (⬆️). That is what counts — 👍 reactions
on comments do not enter the ranking.

Vote honestly: votes inflated by fresh accounts or brigading are discarded. The
point is to measure what people actually want, not who can mobilise the most
people.

### The cycle: how a vote becomes code

Every idea carries a label saying where it stands:

| Label | Meaning |
|---|---|
| `ideia` | Open for votes and discussion |
| `planejado` | Selected — already an issue |
| `em-andamento` | Someone is implementing it |
| `entregue` | Shipped in a published release |
| `fora-de-escopo` | We will not do it — always with the reason explained |

**In the first week of every month**, the ideas up for voting are reviewed. The
**three most-voted** with **at least 5 votes** are selected: they become issues
with scope and acceptance criteria and get the `planejado` label. From there
they follow the normal flow: implementation → PR → release → validation →
delivery.

The floor of 5 votes exists so the cycle does not promote noise in quiet months
— if no idea reaches the floor, none is selected and they all keep accumulating
votes for the following month. Votes do not reset between cycles.

An idea that is not selected **is not rejected** — it stays up for voting. It
only gets `fora-de-escopo` when there is an explicit decision not to do it,
always with the reason written in the discussion.

Two things we commit to:

- **A high vote count is not an automatic promise.** A heavily voted idea can
  still be turned down if it conflicts with what Monky is — P2P, self-hosted, no
  central server and no data collection. When that happens, the reason is
  written in the discussion; we do not let it die in silence.
- **The status goes back to the discussion.** If labels never change, voting
  becomes theatre and people stop voting. Closing that loop is the
  maintainers' obligation.

### Reporting a bug

Bugs start in **[Discussions › Bug Reports](https://github.com/MonkyOrg/Monky/discussions/categories/bug-reports)**, not in Issues.

The path is: you report it → someone from the project confirms it reproduces →
it becomes an issue labelled `bug` and enters the fix queue.

That confirmation step exists to separate real defects from network
misconfiguration, outdated versions or misunderstandings — things that eat the
queue without being bugs. Report anyway when you are unsure: finding out it was
not a bug is a result too.

**There is no voting on bugs.** The category exists for triage, not for a
popularity contest: a confirmed problem gets fixed regardless of how many people
voted for it. Votes are for ideas, where the question is *what to do first* — for
a bug the question is only *is this broken?*.

---

## 💻 Contributing code

### Running the project

Requirements: **Node.js 22+** and your platform's native build tools (the
screen-audio capture module is C++: MSVC on Windows, Xcode Command Line Tools on
macOS).

```bash
git clone https://github.com/MonkyOrg/Monky.git
cd Monky
npm install
npm run build
npm start
```

While developing, in two terminals:

```bash
npm run dev:server   # WebSocket + SQLite server
npm run dev:client   # Electron app with rebuild
```

Server tests:

```bash
npm run test --workspace=apps/server
```

### Before you start coding

**Work from an issue.** If what you want to do is not an issue yet, open the
discussion first — it saves you from investing time in something that would be
turned down in review for being out of scope.

**If the issue is not clear, ask first.** Ambiguous requirements, vague
acceptance criteria or open design decisions are guaranteed rework. Never
assume — comment on the issue and wait for the answer.

**Do not pick up issues marked as blocked.** If you think one of them should
move, comment explaining why before starting.

### Opening the PR

`main` is protected — every merge goes through a squashed PR.

```bash
git checkout -b feat/my-change
# ... commits ...
git push -u origin feat/my-change
```

Branch and commit prefixes follow [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `ci:`. Reference the issue in
the title when there is one: `fix(voice): restore microphone on undeafen (#89)`.

Every PR runs the **CI** workflow, which builds and packages the app on Windows
and macOS (`electron-builder --dir`, without publishing). That catches native
build regressions before the merge — if it fails, the merge does not happen.

### Describe how to test it

In the PR (or the issue), include two sections:

- **How it was implemented** — a technical summary: files and areas changed,
  relevant decisions.
- **How to test** — step by step for validation: scenarios, expected results and
  edge cases.

This is not bureaucracy: whoever validates the change tests from the **published
build**, not from your environment. Without the steps, validation stalls.

> The project's working language is Portuguese, so these sections are written in
> PT-BR in the repository. If you are more comfortable in English, write them in
> English — being clear matters more than the language.

### After the merge

Pushing to `main` triggers the **Release** workflow automatically, which builds
and publishes the new version with the Windows and macOS artifacts. Validation
only starts **after the release is published** — never merely after the merge.

> 🤖 If you are an AI agent working in this repository, the complete and
> mandatory flow is in [`AGENTS.md`](AGENTS.md).

---

## 🧭 What Monky is (and is not)

Useful for calibrating proposals before writing them:

- It **is** a **P2P** voice, video, screen and chat app with a **self-hosted**
  server, for small groups of friends.
- It **is** private by construction: no central server, no mandatory account, no
  telemetry, no data collection.
- It **is not** a Discord alternative at scale — the WebRTC mesh is great for a
  handful of participants and bad for dozens.
- It **is not** a SaaS. There will be no infrastructure hosted by us that people
  are expected to use.

Proposals requiring a central server, sign-up or data collection go against the
project's reason to exist and will be turned down — even when they are good
ideas in the abstract.

---

## 📜 License

By contributing, you agree that your contribution will be licensed under the
project's [MIT license](LICENSE).
