# Realistic GM Screen

A small Foundry VTT v13 module for making GM rolls feel more like rolls behind a physical GM screen.

## Behavior

- Public GM rolls are unchanged.
- Private rolls whispered only to GM users remain visible to the GM normally. Players receive a separate cover message:
  - 1 die: `GM rolled a die.`
  - 2-4 dice: `GM rolled a few dice.`
  - 5+ dice: `GM rolled many dice.`
  - Unknown dice count, usually from custom HTML-only automation cards: `GM rolled some dice.`
- Blind rolls whispered only to GM users remain visible to the GM normally. Players receive a sanitized copy of the original card when possible: visible totals stay, but roll tooltips, formulas, die results, and action data are stripped. If no card can be sanitized, the module falls back to a simple total-only result.
- The original GM-only roll placeholder is hidden from non-GM chat logs, so players do not see Foundry's default `privately rolled some dice` card beside the module message.
- The module wraps `ChatMessage.create`, so most automation rolls are detected before Foundry sends reduced GM-only placeholder cards to player clients.
- Player rolls are unchanged.
- Player-authored private rolls are ignored completely, even when they are whispered to GM users; their original chat cards are not hidden or modified.
- Player-authored blind GM rolls are replaced for non-GM users with a single cover message: `{name} rolled dice blindly behind the GM screen.` The GM still receives the original blind roll.

## Installation

1. Copy `realistic-gm-screen` into `{Foundry userData}/Data/modules/`.
2. Restart Foundry or refresh the module list.
3. Enable `Realistic GM Screen` in the world module settings.

## Localization

English is the base language. Russian localization is included in `lang/ru.json`.

## Settings

World settings let you disable the whole module, disable private-roll cover messages, disable blind-roll total messages, and choose the audience:

- `Players only`: the player-facing message is whispered to non-GM users. This is the default.
- `Public`: everyone sees the player-facing message.

## Note

Foundry v13 stores roll privacy through `whisper`, `blind`, and `rolls`. The module preserves the original GM-only roll message and creates a separate player-facing message, so it should compose more gently with systems and modules that read the original roll.
