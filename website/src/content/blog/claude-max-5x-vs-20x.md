---
title: "Claude Max: two 5x accounts vs. one 20x, same price, opposite bets"
description: "One Max 20x costs the same as two Max 5x. The multipliers price per-session usage, not the weekly cap, so the real fork is depth vs. breadth, not big vs. small."
date: 2026-06-26
slug: claude-max-5x-vs-20x
author: Tobias Strebitzer
keywords: ["claude", "claude max", "claude code", "anthropic", "rate limits", "claude max 5x", "claude max 20x", "prompt caching", "ai pricing", "llm cost"]
ogImage: ../../assets/blog/claude-max-5x-vs-20x.png
socialLinks:
  reddit: "https://www.reddit.com/r/ClaudeAI/comments/1ug6kjv/two_max_5x_accounts_cost_the_same_as_one_20x_and/"
  x: ""
  linkedin: ""
draft: false
---

If you're a solo builder paying Anthropic for Claude Max, you've probably hit the wall, looked at the "20x" tier, and felt the pull to upgrade. The number is doing exactly what it's designed to do. I want to argue that for most people the upgrade is the wrong purchase. Not because it's a bad plan, but because the names quietly retrain your intuition and then bill you on an axis you weren't watching.

Here's the setup. One Max 20x costs the same per month as two Max 5x accounts. So the honest question isn't "5x or 20x," it's "one big bucket or two medium ones, for the same money." And the answer depends entirely on whether you're depth-bound or breadth-bound, opposite problems that want opposite SKUs.

## What "5x" and "20x" actually measure

This is the load-bearing fact, and it's the one Anthropic actually commits to in writing. The multipliers describe **per-session** usage. Anthropic's Max plan help page states it plainly: Max 5x gives "5 times more usage per session than Pro," and 20x gives "20 times more usage per session." That's the committed claim. ([support.claude.com](https://support.claude.com/en/articles/11049741-what-is-the-max-plan))

So "20x" reads like "four times more of everything than 5x." It isn't. It's four times the *session* ceiling. The reflex (hit a wall, climb a tier) is the marketing working on you, because the wall you hit on a long week is usually not the session wall.

The same help page confirms Max plans also carry **two separate weekly limits**, one across all models and one for Sonnet only, sitting on top of the per-session multiplier. Critically: Anthropic publishes the *structure* but **no current numbers** for those weekly caps. So whether they scale 1:1 with the per-session multiplier, or less, is not something you can read off an official page today. My working assumption, and I'll be explicit that this is an *inference* and not a published figure, is that the weekly bucket does **not** grow a clean 4x between tiers. If it did, the per-session framing would be redundant. But I can't prove the exact ratio, and neither can anyone quoting you a number.

## The numbers everyone cites are retired

You'll find tables online claiming Max 5x is roughly 140–280 Sonnet hours plus 15–35 Opus hours a week, and 20x roughly 240–480 Sonnet plus 24–40 Opus. Treat those as **historical, not current.** They match Anthropic's July 2025 rate-limit estimates as reported by TechCrunch at the time, and those figures are **no longer published on the current Max page.** ([techcrunch.com](https://techcrunch.com/2025/07/28/anthropic-unveils-new-rate-limits-to-curb-claude-code-power-users/))

They've almost certainly drifted since. On May 6 2026 Anthropic doubled the Claude Code 5-hour session limits for Pro and Max and removed peak-hour throttling, but that announcement changed the *session* windows and left the weekly caps untouched. ([anthropic.com](https://www.anthropic.com/news/higher-limits-spacex)) So even the retired numbers are now wrong in a specific, known direction.

Notice what that May change did to the argument, though: it widened the session spigot without widening the weekly bucket. That's the trend line. The constraint keeps migrating *away* from the session and *toward* the week, which is exactly the axis the tier name doesn't price.

One more caution, because it's been circulating as if it's live: Anthropic announced a separate monthly credit pool for **headless** usage (Agent SDK, `claude -p`, scheduled runs), $20 Pro / $100 Max 5x / $200 Max 20x, no rollover, slated for June 15 2026. **It was paused before it took effect.** ([digitalapplied.com](https://www.digitalapplied.com/blog/anthropic-claude-credit-overhaul-june-15-2026)) It is not current behavior. I mention it only so you don't restructure your spend around a thing that didn't ship.

## The real fork: depth vs. breadth

Strip away the digits and the structure is clean.

**If you're depth-bound, buy the 20x.** Depth means one task that needs an enormous unbroken context: a big agentic run, ultrathink on a hard problem, a large-context refactor where the whole point is keeping everything in one head. Two accounts **physically cannot pool onto one task.** Session state, conversation history, compacted context, the todo list, and the usage dashboards are all account-bound, with no merging them mid-flight. The 20x's larger session ceiling is the only thing that buys depth, and the second account can't substitute for it.

**If you're breadth-bound, buy two 5x.** Breadth means several independent lanes running in parallel: a feature here, a doc rewrite there, an experiment in a third repo, none of which needs the others' context. Two accounts give you roughly double the weekly headroom for the same price as one 20x, and the lanes were already separate, so the account boundary costs you nothing.

## The switching tax, and the cache nobody counts

The switching tax is the part people underestimate. Moving a task across accounts isn't free. You lose the in-flight session, the compacted context, the history. And there's a quieter line item underneath all of that: the prompt cache.

Here's the mechanism, and it's documented. Claude Code re-sends your whole context on every turn (the system prompt, your project files, the entire conversation), and prompt caching is the only reason that's affordable: the API reads the unchanged prefix from cache instead of reprocessing it. The catch is that the cache is keyed to the account. Anthropic's own docs say caches are isolated between organizations, and that resuming a cold conversation "reprocesses the entire conversation history with no cache hits," where "the first turn back into a long session can be the most expensive request you send." ([code.claude.com](https://code.claude.com/docs/en/prompt-caching)) Move a deep task to your second account and you start cold: the whole history gets re-read as fresh, uncached input.

How big a deal is that? Take my own Claude Code usage since May, measured locally (these are my numbers, not an audited figure): 4.5 billion tokens, and effectively all of them are cache reads. 267 sessions, almost entirely on Opus. The "API-equivalent" cost reads about $3,613, except I never paid that, because on a Max subscription usage is bundled, not billed per token. That last point is what defuses the cache worry. Anthropic's docs are explicit that on a subscription "usage is included in your plan rather than billed per token," and the cache mostly affects how long your context stays warm. ([code.claude.com](https://code.claude.com/docs/en/prompt-caching)) So losing the cache on a switch is a one-time latency hit on the first turn back, not a metered cost that drains your wallet.

Does it drain your *session budget*, though? That I can't tell you for certain, and I'll flag it as inference: Anthropic doesn't document the cache counting for or against the session ceiling, and frames the subscription cache as a speed-and-warmth feature. Given how large a Max session ceiling is, my read is that the cold-start re-read is a few seconds of latency, not a meaningful dent. So the cache is real, it's worth knowing about, and on a flat Max plan it's almost certainly not the thing that should change your decision.

Net it out: if your work is one deep thing, the switching tax (session, context, and cache together) is constant, so the 20x wins on more than raw ceiling. If your work is many shallow things, you were never sharing context anyway, so the tax is close to zero.

## Two caveats before you act

Holding multiple Max accounts is **not** a terms violation in itself. What *is* a violation: routing subscription OAuth tokens through third-party tools, account sharing or reselling, and deliberate limit evasion, all on Anthropic's suspension list per their February 2026 consumer-terms clarification. ([theregister.com](https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/)) Two accounts for two streams of your own work is fine; building a token-pooling contraption to dodge a cap is not.

And there's a stale, **user-reported** wrinkle worth knowing: a community GitHub issue reports that two accounts signed in simultaneously can cross-contaminate usage counters and sync reset timers. ([github.com/anthropics/claude-code#12190](https://github.com/anthropics/claude-code/issues/12190)) It is not an Anthropic-confirmed defect, and I haven't reproduced it cleanly. If you run two accounts, keep them in separate environments and watch for it.

So: don't buy the tier name. Open `/usage`, look at whether you're actually hitting the *session* wall or the *weekly* wall, and notice whether your work is one deep thing or many shallow ones. The honest answer is usually obvious once you ask the depth-vs-breadth question instead of the big-vs-small one, and it's worth getting right, because either way you're deciding how to spend $200 a month.
