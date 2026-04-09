---
title: "The Silkweave Manifest"
description: "Why I'm building Silkweave - design principles, the case for lean stacks, and what the AI ecosystem still needs to figure out."
date: 2026-04-09
slug: the-silkweave-manifest
author: Silkweave
keywords: ["silkweave", "mcp", "typescript", "design principles", "ai ecosystem", "manifesto", "lean stack"]
socialLinks:
  reddit: ""
  x: ""
  linkedin: ""
draft: false
---

Silkweave started with a frustration. Not the exciting kind, the slow-building kind you get from watching the same problem go unsolved across project after project. You define a piece of business logic. Then you write it again for your API. Then again for your CLI. Then again for MCP. Each time with different boilerplate, different error handling, different ways to describe the same input schema.

The core idea behind Silkweave is simple: **define an action once, deploy it everywhere.** One function with a Zod schema. One set of input validation rules. Expose it as an MCP tool, a REST endpoint, a CLI command, or a Vercel serverless function, all from the same definition.

## The Case for Lean Stacks

I've built applications with Next.js, Nest.js, Remix / React-Router, Nuxt, and many other full-featured frameworks. They're impressive pieces of engineering. But somewhere along the way I stopped being able to read all the code that runs my application. Middleware chains became opaque. Build pipelines became multi-stage mysteries. The abstraction layers stacked so high that debugging meant spelunking through node_modules.

Silkweave is a deliberate step back toward tools I can fully understand. Express over framework magic. Zod over runtime type gymnastics. Direct function calls over dependency injection containers. The entire core library is something you can read in an afternoon.

This isn't anti-framework, it's pro-legibility. When an AI agent is helping you write code - or when you're reviewing what an agent wrote - you need to be able to trace every path through your system. A lean stack makes that possible.

## The AI Ecosystem Challenge

My biggest challenge in the AI tooling space right now isn't capability - it's **infrastructure**. We have models that can reason about code, generate entire features, and debug complex systems. What we don't have is a clean way to give them access to our tools.

MCP is a step in the right direction. It standardizes how models discover and invoke tools. But we're still figuring out the fundamentals:

- **How much should AI do?** The ratio of human-to-AI work isn't fixed. Some tasks - mechanical refactors, boilerplate generation, test scaffolding - are better delegated entirely. Others - architectural decisions, security reviews, user-facing copy - need human judgment. We don't have good frameworks for deciding where that line is.

- **Context is everything.** Models are only as good as the context they receive. Today, most MCP integrations dump everything into the context window and hope for the best. We need smarter patterns - selective context, progressive disclosure, disposition-aware responses. (I explore this in more detail in [The MCP Disposition Dilemma](/blog/the-mcp-disposition-dilemma).)

- **Agent-to-agent collaboration.** We talk a lot about AI agents collaborating with humans. But what about agents collaborating with other agents? An orchestrator agent that delegates subtasks to specialized tool agents. A review agent that checks the output of a generation agent. The layers of exchange - API, CLI, MCP - become the fundamental interfaces for machine-to-machine collaboration, not just human-to-machine.

## What Silkweave Should Do

Silkweave should be **the thinnest possible layer** between your business logic and the transport that delivers it. It should:

- Let you define an action in under 10 lines of code
- Validate inputs at the boundary, not deep in the stack
- Generate documentation (OpenAPI, MCP tool descriptions) from the same schema
- Stay out of the way when you need to access the underlying primitives

## What Silkweave Should Not Do

Silkweave should not become a framework. It should not have opinions about your database, your auth provider, your deployment target, or your state management. It should not require you to learn a DSL. It should not grow a plugin ecosystem that becomes load-bearing.

The moment Silkweave becomes something you can't read in an afternoon, it has failed.

## An Invitation

If you're building MCP servers, CLI tools, or REST APIs and you're tired of writing the same action three different ways - give Silkweave a look. And if you have ideas about how the AI ecosystem should evolve, I'd love to hear them. This is an ongoing conversation, and the best ideas I've encountered so far have come from practitioners who are building real things and hitting real walls.
