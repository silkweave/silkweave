---
title: "The MCP Disposition Dilemma"
description: "A fundamental gap in how MCP handles tool responses - and a proposal for content disposition annotations."
date: 2026-04-09
slug: the-mcp-disposition-dilemma
author: Silkweave
keywords: ["mcp", "content disposition", "llm", "context window", "protocol", "annotations", "model context protocol"]
socialLinks:
  reddit: ""
  x: ""
  linkedin: ""
draft: false
---

When an MCP tool returns a response, the full content gets ingested into the LLM's context window. This works fine for discovery data, summaries, and smaller payloads. But for anything involving large datasets, query results, or generated artifacts, it becomes a real problem. You're burning tokens, blowing up context limits, and the model's reasoning quality degrades because it's drowning in data it doesn't need to "see" to do its job.

## The Problem

I work with teams that include non-developers. MCP gives us authentication, permission scoping, and a standardized interface that doesn't require giving AI access to arbitrary shell commands or Python scripts. If the answer to "MCP can't handle large payloads" is "just use subprocess calls," we've essentially told non-technical users they can't participate in data-heavy AI workflows. That's not a good outcome.

## Protocol vs. Implementation

I don't believe this is purely an implementation problem, and it's not purely a protocol problem either.

From what I understand, the MCP spec doesn't mandate that every byte of a tool response hits the model. That's a host decision, Claude Desktop, Cursor, and others each make their own choices. But the protocol also doesn't give servers a way to signal: "this part is for the model, this part should be stored separately." There's no concept of *content disposition* in tool responses.

I've seen a number of workarounds that are clever, but in my opinion should be solved at the protocol level:

- **Proxy interception** - Proxies that intercept MCP responses and truncate or summarize before passing to the LLM
- **Server-side storage** - Tools that save payloads server-side and return file paths (which breaks down unless you're running locally)
- **Resource shifting** - Moving artifacts to MCP resources, which is probably the cleanest approach but adds real complexity for stateless or distributed servers

## A Proposal: Content Disposition Annotations

MCP already has annotations on content blocks, with `audience`, `priority`, and `lastModified`. These are designed as hints to clients. What if we extended this with a `disposition` field?

```json
{
  "content": [{
    "type": "text",
    "text": "Found 15,847 records matching your query. Here's a summary: ..."
  }, {
    "type": "text",
    "text": "{...large JSON payload...}",
    "annotations": {
      "disposition": "deferred",
      "uri": "mcp://server/results/abc123",
      "hint": "structured-data"
    }
  }]
}
```

The idea: when a host sees `disposition: "deferred"`, it stores that content using whatever storage adapter makes sense - local file, database, cloud storage - and presents the LLM with just a reference. The model never sees the bulk data in its context window, but can retrieve it when needed, either through a built-in fetch tool or by processing it via scripts.

## Why This Works

This approach is **backwards-compatible**. Hosts that don't understand the annotation just do what they do today and dump everything into context. Hosts that support it get massive efficiency gains. Servers don't need to restructure their responses - they just add an annotation.

Think of it like email attachments. The MIME message contains the full data inline, but your email client shows you a summary and a download link. The server doesn't need to know how the client stores the attachment.

## Open Questions

I'm not an LLM protocol expert. I'm a software engineer who's been building MCP servers and running into this wall repeatedly. I might be conceptually wrong on some of this, and I'd genuinely appreciate corrections.

Specifically:

- **Is this a problem worth solving?** Or are there better solutions outside of MCP - i.e., am I missing the mark?
- **Has this already been solved** and I just couldn't find it?
- **Are there technical reasons** why content disposition at the annotation level wouldn't work?

If you're working on MCP tooling and hitting the same walls, I'd love to hear your approach. And if you think this direction has merit, consider it an open invitation to collaborate on a proposal.
