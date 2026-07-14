---
title: "Automate around the ceremony"
description: "npm now requires a live human at the moment of publish, and it was right to. The answer for agent workflows is not a bypass token - automate the plumbing and keep hardware-backed user presence as the last gate."
date: 2026-07-15
slug: automate-around-the-ceremony
author: Tobias Strebitzer
keywords: ["npm", "webauthn", "touch id", "secure enclave", "eotp", "2fa", "mcp", "claude code", "supply chain security", "keybridge", "human in the loop"]
ogImage: ../../assets/blog/automate-around-the-ceremony.png
socialLinks:
  reddit: ""
  x: ""
  linkedin: ""
draft: false
---

Last week a Claude Code session of mine built a package, ran the tests, bumped the version, wrote the changelog, and then died at the finish line:

```
npm error code EOTP
npm error This operation requires a one-time password from your authenticator.
```

If you publish to npm, you have probably met this error recently. npm has spent the past year systematically removing nearly every credential-based way to publish without a human present (trusted publishing via OIDC from CI remains the sanctioned unattended path). Classic tokens were permanently revoked in December 2025 ([GitHub changelog](https://github.blog/changelog/2025-12-09-npm-classic-tokens-revoked-session-based-auth-and-cli-token-management-now-available/)). New TOTP setups are disabled, and existing ones are being phased out ([changelog, 2025-09-29](https://github.blog/changelog/2025-09-29-strengthening-npm-security-important-changes-to-authentication-and-token-management/)). Login sessions now enforce 2FA for publishing operations. The practical result: on an account with WebAuthn 2FA, an interactive local publish wants a fresh WebAuthn ceremony in a browser, and a non-interactive one, from a script or from an agent, simply fails with EOTP.

Here is the part I want to argue for: **npm was right to do this.** A long-lived token that can publish is a long-lived token that can be stolen and used to publish, and that is the class of credential the supply-chain incidents npm was responding to kept exploiting. Requiring a live human assertion at the moment of publish is the correct design.

It also broke my workflow, and probably yours. Both things are true, and the interesting question is what to do about the second one without undoing the first.

## The tempting fix removes the point

npm's official escape hatch for automation is the granular access token with 2FA bypass. It works today. It is also, precisely, a mechanism for publishing without a human present, which is the exact capability npm has been methodically removing everywhere else. If your fix for "publishing now requires a human" is a credential that removes the human, you have not solved the automation problem. You have re-created the vulnerability with extra steps.

npm seems to agree: per the [July 2026 changelog](https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/), bypass-2FA tokens lose the ability to publish directly around January 2027. After that they can only stage a publish that goes live after a human approves it with 2FA. The bypass token is a dead end with a posted closing date.

So the wrong axis is "how do I get rid of the ceremony." The ceremony is not the obstacle. The ceremony is the feature.

## What is actually toil, and what is actually the gate

Look closely at what happens when you publish interactively on a WebAuthn account. The CLI prints a URL. You open a browser. You wait for a page to load. You touch your security key or your fingerprint reader. The CLI notices, retries, and the publish goes through.

Exactly one step in that sequence requires a human: the touch. Everything else is plumbing. Opening a browser is not a security control. Polling for completion is not a security control. Re-running the publish with a one-time token is not a security control. The security control is the user-presence check, the one thing in the chain that cannot be scripted, because the whole point of WebAuthn user presence is that it cannot be scripted.

That gives you the design brief: automate everything around the ceremony, never the ceremony itself. The agent initiates the publish. The machine handles the hand-off and the plumbing. The human stays as the last gate, and only as the last gate.

## What the machine can do

It turns out npm's own CLI cooperates with this design, mostly on purpose.

**The hand-off is machine-readable.** Since npm CLI 11.9, a publish that needs web authentication surfaces `authUrl` and `doneUrl` in the `--json` error output ([npm/cli PR #8952](https://github.com/npm/cli/pull/8952), shipped in [v11.9.0](https://github.com/npm/cli/releases/tag/v11.9.0)). `authUrl` is the verification page the human needs to clear; `doneUrl` is a polling endpoint that eventually yields a one-time token you pass back via `npm publish --otp=<token>`. That is a public CLI contract, no private APIs, no scraping the TTY.

**You need a real browser engine, and the reason is not npm.** My first instinct was to drive the auth flow with plain HTTP. That fails before npm's auth layer ever sees you: www.npmjs.com sits behind a Cloudflare anti-bot challenge. I checked on 2026-07-14: `curl https://www.npmjs.com/login` returns a 403 with the "Just a moment..." interstitial and a `cf-mitigated: challenge` header. A pure HTTP client is filtered out at the door. So the verification page has to load in an actual browser engine. On macOS that can be an invisible, windowless WKWebView: real WebKit, no window on your screen, executing npm's real verification page. A visible window appears exactly once, for the first-run password login, because you should see where you are typing your password.

**Answering the ceremony uses the password-manager technique.** The page calls `navigator.credentials.get()` expecting a platform authenticator. You inject a script that overrides `navigator.credentials.create` and `get`, satisfies the request from your own authenticator, and falls back to the native implementation for anything it does not handle. If that sounds suspicious, note that it is exactly how browser-extension password managers answer WebAuthn today; Bitwarden [documents the interception, injection, and fallback in their own architecture docs](https://contributing.bitwarden.com/architecture/deep-dives/passkeys/implementations/provider/browser-extension/). The technique is standard. What matters is whose key answers, which brings us to the actual gate.

**The key lives in the Secure Enclave and only signs after Touch ID.** The credential that answers npm's ceremony is a P-256 key generated inside the Secure Enclave, non-extractable by design, with an access-control policy that refuses to sign without a live biometric check through LocalAuthentication. There is no code path to a signature that does not pass through a human finger on the sensor. This is the one step that stays manual, and it stays manual because no software can fake it.

**Then it is plumbing again.** Poll `doneUrl`, collect the one-time token, re-run the publish with `--otp`. Done.

One sharp edge worth knowing about: npm CLI versions 11.9.0 through 11.14.x redact the session id when they print `authUrl` in `--json` output, so you get `.../auth/cli/***` instead of a usable URL. It is fixed in 11.15.0 and later. For the affected versions, the workaround I landed on is to trigger the authentication challenge myself with a metadata-only PUT against the registry, which returns the unredacted URL in the response body instead of through the CLI's redacting logger. That workaround is my own; treat it as such until you have reproduced it.

## Two gates, not a bypass

The obvious objection is "you automated the second factor." I do not think that survives contact with the architecture, and it is worth being precise about why.

Both factors are still standing. npm's server still demands a fresh WebAuthn assertion for every publish it gates. The key that produces that assertion cannot leave the Secure Enclave and will not sign without a live Touch ID. What got automated is the toil around the assertion: the browser hop, the token relay, the retry. User presence was not automated, because it cannot be.

In the agent setup there are in fact two independent gates. The first is agent-side: the publish capability is exposed as MCP tools (MCP is the tool-calling protocol agents like Claude Code use) with typed inputs, so there is no flag injection and the working directory cannot escape the project, plus a PreToolUse hook (a rule that intercepts the agent's shell commands before they run) that flatly denies raw `npm publish`, `pnpm publish`, and `yarn publish` in the shell. The agent cannot reach the ceremony except through the front door it was given. The second gate is human-side: the Touch ID that no script can satisfy. The agent initiates; the human approves. Compare that honestly with the bypass-2FA token, which deletes the second gate entirely.

There is a real concession to make here, and it is a design constraint rather than a footnote: the trust boundary moves. With a stock browser, you trust npm's page and your platform authenticator. With this pattern, you trust the code that intercepts `navigator.credentials`, because a modified build could misuse that position. That is a genuine shift, and it dictates the next requirement.

## Open source is a requirement here, not a virtue

Code that answers WebAuthn ceremonies for your npm account is the trust boundary. Not "benefits from transparency." Is the boundary. For this class of infrastructure, closed source is disqualifying, in the same way an unauditable password manager would be. The security-relevant surface has to be small enough to actually read: the injected credentials override, the enclave signer, the web shell that drives the page. If you would not read that code, you should not run it, and reading it has to be possible.

## The existence proof

I built this. It is called [keybridge](https://github.com/tobiasstrebitzer/keybridge): a CLI (`keybridge setup / login / enroll / publish`), a Claude Code plugin, and an MCP server exposing typed publish tools, with the PreToolUse hook described above. I validated it end-to-end against npm production on 2026-07-14; that is my own validation, not an independent audit. It is on the npm registry (`npm install -g keybridge`), and yes, the package was published with keybridge itself: one Touch ID tap.

The trades, plainly:

- **macOS only.** The design leans on the Secure Enclave and WKWebView; on other platforms it falls back to opening your default browser, which keeps the ceremony but loses the invisibility. I took that trade because a hardware-backed, non-extractable key with a biometric policy is the strongest honest version of "the human is the gate," and macOS is where I can get it today.
- **The invisible-browser technique is also a malware technique.** An unseen browser driving an auth page is what credential-stealing malware does. The difference is not the mechanism; it is consent and inspectability. keybridge runs npm's own documented hand-off, on your machine, at your initiation, exfiltrates nothing, and every injected line is in the repo. That is the standard I think you should hold anything in this position to, including this.
- **AI disclosure.** Claude Code contributed substantially to keybridge; the README says so. The security-relevant behavior was verified by me, a human, against npm production. A tool for keeping humans in the loop of agent workflows, built partly by an agent with a human in the loop, is either fitting or ironic. I lean fitting.

## One ceremony among many

npm publish is not special. It is just the ceremony that broke first, because npm moved first. PyPI publishes, cargo publishes, Docker Hub pushes, release signing, production deploy approvals: all of them are converging on the same shape, where the sensitive action wants a live human and the surrounding workflow wants to be automated. The pattern here, agent initiates, machine does the plumbing, hardware-backed user presence as the last un-scriptable gate, is not an npm trick. It is what human-in-the-loop should mean mechanically, instead of as a slogan.

Which ceremony do you want this pattern for next: PyPI, cargo, Docker Hub, signing a release, or approving a production deploy?
