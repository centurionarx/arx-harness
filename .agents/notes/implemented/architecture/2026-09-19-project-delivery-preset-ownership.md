# Agent Note: Preset ownership of project and delivery tools

Status: implemented

English | [Português](2026-09-19-project-delivery-preset-ownership.pt-BR.md)

## Problem

Host tool registrations become visible to every preset, including the fixed two-tool minimal agent. A project domain shared by browser RPCs does not require its model-facing consumer to share the same registration scope.

## Decision

The standard, code, and cordis presets mount the project and delivery consumers in their standing scopes. The Web host keeps the durable project domain and browser services. A preset explicitly disables its project consumer when its host supplies no project domain; raw hosts can therefore reuse the preset without installing the optional domain. Delivery consumes the filesystem already supplied by the host.

## Alternatives considered

Global registration breaks the fixed minimal catalog. Filtering by preset name in a tool would duplicate composition policy inside the consumer. Declaring the tools in each owning preset preserves the existing scoped registration contract.

## Consequences

Minimal retains exactly its platform shell and editor. New custom presets choose these tools by composition. The assembled minimal snapshot asserts both catalog and direct lookup isolation; replayed conversation goldens include the optional turn outline tab.
