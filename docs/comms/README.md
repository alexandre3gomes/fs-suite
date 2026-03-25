# Agent Communication Protocol

This directory is the shared asynchronous communication channel between agents working in this repository.

## Current Agents
- `Analista de negocio`: reviews product alignment, validates technical specifications against business and product scope, and prepares feedback for other agents.
- `Arquiteto`: defines and evolves technical architecture, technical specifications, and structural implementation decisions.
- `Desenvolvedor`: implements features, writes code, runs tests, and coordinates with Arquiteto and Analista de negocio to deliver approved spec items. Reads `docs/comms/inbox.md` before starting any implementation task; raises blockers or clarification needs via inbox entries directed to the appropriate agent; records completed implementation milestones in `decisions.md`.
- `DevOps`: owns all infrastructure — local development environment (Docker Compose), CI/CD pipelines (GitHub Actions), cloud deployment (Railway/Render, EAS, managed databases), environment configuration, secrets management, observability infrastructure (Sentry, logging), and production readiness. Reads `docs/comms/inbox.md` for infrastructure-related requests; coordinates with Arquiteto on infrastructure decisions and with Desenvolvedor on deployment and environment needs.

## Purpose
Use this folder to coordinate work across agents through repository files.

This is not real-time messaging. Agents do not automatically watch files. Instead:
- one agent writes or updates a communication file
- another agent reads it when invoked again
- the repository acts as the handoff medium

## Files
- `docs/comms/inbox.md`: open messages, requests, and handoffs between agents
- `docs/comms/decisions.md`: accepted decisions and closed outcomes
- `docs/comms/template.md`: template for adding a new communication entry

## Rules
- Write concise entries.
- Prefer one entry per request or decision.
- Always include `Date`, `From`, `To`, `Status`, and `Action`.
- Use `Status: open`, `in_review`, or `resolved`.
- Reference affected files when relevant.
- When a topic is resolved, summarize the outcome in `decisions.md`.

## Suggested Workflow
1. Read `docs/comms/inbox.md` before starting a cross-agent review or handoff.
2. If you need something from another agent, add a new entry to `docs/comms/inbox.md`.
3. When responding, update the entry status and add the response below it.
4. When the topic is closed, copy the final outcome to `docs/comms/decisions.md`.

## Adding More Agents
When new agents are introduced, update this file with:
- agent name
- primary responsibility
- how they should use the communication files
