# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- Licence changed from MIT to Apache-2.0 from this version on.
- Removed operator-specific data from tracked files.

## [0.1.0] - 2026-02-14

### Added

- A2A bridge plugin for OpenClaw: public agent card, bearer-authenticated JSON-RPC `message/send` endpoint that forwards to the chat completions endpoint, and the `a2a_call_remote`, `a2a_list_remote_agents` and `a2a_discover_remote` tools.
- Release polish: plugin manifest, config schema and README.
