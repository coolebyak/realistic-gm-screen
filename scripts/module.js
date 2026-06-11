const MODULE_ID = "realistic-gm-screen";

const SETTINGS = {
  enabled: "enabled",
  privateStubs: "privateStubs",
  blindResults: "blindResults",
  audience: "audience",
  debug: "debug"
};

const FLAGS = {
  synthetic: "synthetic",
  sourceMessageId: "sourceMessageId",
  purpose: "purpose"
};

const postedSources = new Set();

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SETTINGS.enabled, {
    name: `${MODULE_ID}.settings.enabled.name`,
    hint: `${MODULE_ID}.settings.enabled.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.privateStubs, {
    name: `${MODULE_ID}.settings.privateStubs.name`,
    hint: `${MODULE_ID}.settings.privateStubs.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.blindResults, {
    name: `${MODULE_ID}.settings.blindResults.name`,
    hint: `${MODULE_ID}.settings.blindResults.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.audience, {
    name: `${MODULE_ID}.settings.audience.name`,
    hint: `${MODULE_ID}.settings.audience.hint`,
    scope: "world",
    config: true,
    type: String,
    choices: {
      public: `${MODULE_ID}.settings.audience.choices.public`,
      players: `${MODULE_ID}.settings.audience.choices.players`
    },
    default: "players"
  });

  game.settings.register(MODULE_ID, SETTINGS.debug, {
    name: `${MODULE_ID}.settings.debug.name`,
    hint: `${MODULE_ID}.settings.debug.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
});

Hooks.once("ready", () => {
  patchChatMessageCreate();
});

Hooks.on("createChatMessage", (message, options, userId) => {
  createPlayerFacingMessage(message, options, userId).catch((error) => {
    console.error(`${MODULE_ID} | Failed to create player-facing roll message`, error);
  });
});

Hooks.on("renderChatMessageHTML", (message, html) => {
  if (!shouldHideOriginalGmOnlyRoll(message)) return;

  html.classList.add("rgs-hidden-source-roll");
  html.style.display = "none";
});

function patchChatMessageCreate() {
  if (!globalThis.ChatMessage?.create) return;
  if (ChatMessage.create._rgsPatched) return;

  const originalCreate = ChatMessage.create;

  ChatMessage.create = async function wrappedCreate(data, options = {}) {
    const created = await originalCreate.call(this, data, options);

    createPlayerFacingMessageFromCreateData(data, options, created).catch((error) => {
      console.error(`${MODULE_ID} | Failed to create player-facing roll message from ChatMessage.create`, error);
    });

    return created;
  };

  ChatMessage.create._rgsPatched = true;
  ChatMessage.create._rgsOriginal = originalCreate;
  debug("ChatMessage.create patched");
}

async function createPlayerFacingMessage(message, options, userId) {
  if (!game.settings.get(MODULE_ID, SETTINGS.enabled)) return;
  if (message.getFlag(MODULE_ID, FLAGS.synthetic)) return;
  if (!isSyntheticMessageCreator()) return;
  if (isPlayerAuthoredBlindGmRoll(message, options)) {
    await postPlayerBlindStub(message, sourceKeyFromMessage(message));
    return;
  }
  if (!isGmAuthoredMessage(message)) return;
  if (hasPostedSource(sourceKeyFromMessage(message))) return;

  const mode = inferMessageMode(message, options);
  if (mode === "public" || mode === "self") return;

  const isBlind = mode === "blind" || isBlindGmOnlyRoll(message);
  const isPrivate = mode === "gm" || isPrivateGmOnlyRoll(message);
  debug("createChatMessage", {
    messageId: message.id,
    mode,
    isBlind,
    isPrivate,
    hasRolls: getRolls(message).length > 0
  });
  if (!isBlind && !isPrivate) return;

  if (isBlind && game.settings.get(MODULE_ID, SETTINGS.blindResults)) {
    await postBlindResult(message, sourceKeyFromMessage(message));
    return;
  }

  if (isPrivate && game.settings.get(MODULE_ID, SETTINGS.privateStubs)) {
    await postPrivateRollStub(message, sourceKeyFromMessage(message));
  }
}

async function createPlayerFacingMessageFromCreateData(data, options, created) {
  if (!game.settings.get(MODULE_ID, SETTINGS.enabled)) return;
  if (!isSyntheticMessageCreator()) return;

  const pairs = Array.isArray(data)
    ? data.map((entry, index) => [entry, Array.isArray(created) ? created[index] : null])
    : [[data, created]];

  for (const [entry, createdMessage] of pairs) {
    const sourceMessage = buildSourceMessageFromCreateData(entry, createdMessage);
    if (!sourceMessage) continue;
    if (sourceMessage.getFlag(MODULE_ID, FLAGS.synthetic)) continue;
    if (isPlayerAuthoredBlindGmRoll(sourceMessage, options)) {
      await postPlayerBlindStub(sourceMessage, sourceKeyFromMessage(sourceMessage));
      continue;
    }
    if (!isGmAuthoredMessage(sourceMessage, { defaultToCurrentGm: true })) continue;

    const sourceKey = sourceKeyFromMessage(sourceMessage);
    if (hasPostedSource(sourceKey)) continue;

    const mode = inferMessageMode(sourceMessage, options);
    if (mode === "public" || mode === "self") continue;

    const isBlind = mode === "blind" || isBlindGmOnlyRoll(sourceMessage);
    const isPrivate = mode === "gm" || isPrivateGmOnlyRoll(sourceMessage);
    debug("ChatMessage.create", {
      messageId: sourceMessage.id,
      mode,
      isBlind,
      isPrivate,
      whisper: getWhisperIds(sourceMessage),
      hasRolls: getRolls(sourceMessage).length > 0
    });

    if (isBlind && game.settings.get(MODULE_ID, SETTINGS.blindResults)) {
      await postBlindResult(sourceMessage, sourceKey);
      continue;
    }

    if (isPrivate && game.settings.get(MODULE_ID, SETTINGS.privateStubs)) {
      await postPrivateRollStub(sourceMessage, sourceKey);
    }
  }
}

async function postPrivateRollStub(sourceMessage, sourceKey = null) {
  markPostedSource(sourceKey);

  const messageData = buildSyntheticMessageData(sourceMessage, {
    purpose: "private-stub",
    content: renderPrivateStub(getDiceCount(sourceMessage))
  });

  if (messageData) await ChatMessage.create(messageData);
}

async function postBlindResult(sourceMessage, sourceKey = null) {
  const totals = getRollTotals(sourceMessage);
  const content = renderSanitizedBlindCard(sourceMessage) ?? (totals.length ? renderBlindResult(totals) : null);

  if (!content) {
    debug("blind total not found", {
      messageId: sourceMessage.id,
      hasRolls: getRolls(sourceMessage).length > 0,
      contentPreview: String(sourceMessage.content ?? "").slice(0, 500),
      rawKeys: Object.keys(sourceMessage.raw ?? {})
    });
    return;
  }

  markPostedSource(sourceKey);

  const messageData = buildSyntheticMessageData(sourceMessage, {
    purpose: "blind-result",
    content
  });

  if (messageData) await ChatMessage.create(messageData);
}

async function postPlayerBlindStub(sourceMessage, sourceKey = null) {
  if (hasPostedSource(sourceKey)) return;
  markPostedSource(sourceKey);

  const authorName = getMessageAuthorName(sourceMessage);
  const messageData = buildSyntheticMessageData(sourceMessage, {
    purpose: "player-blind-stub",
    content: renderPlayerBlindStub(authorName),
    audience: getPlayerAudience()
  });

  if (messageData) await ChatMessage.create(messageData);
}

function buildSyntheticMessageData(sourceMessage, { purpose, content, audience = null }) {
  audience ??= getAudience();
  if (!audience) return null;

  return {
    user: game.user.id,
    speaker: { alias: localize("speaker.gm") },
    content,
    whisper: audience.whisper,
    blind: false,
    flags: {
      [MODULE_ID]: {
        [FLAGS.synthetic]: true,
        [FLAGS.sourceMessageId]: sourceMessage.id,
        [FLAGS.purpose]: purpose
      }
    }
  };
}

function getAudience() {
  if (game.settings.get(MODULE_ID, SETTINGS.audience) !== "players") {
    return { whisper: [] };
  }

  return getPlayerAudience();
}

function getPlayerAudience() {
  const playerIds = getUsers()
    .filter((user) => !user.isGM)
    .map((user) => user.id);

  return playerIds.length ? { whisper: playerIds } : null;
}

function renderPrivateStub(diceCount = null) {
  const key = Number.isFinite(diceCount) && diceCount > 0
    ? `privateStub.${getDiceCountBucket(diceCount)}`
    : "privateStub.unknownDice";

  return `
    <div class="rgs-card rgs-private-stub">
      <div class="rgs-kicker"><i class="fas fa-dice-d20"></i> ${localize("privateStub.title")}</div>
      <div class="rgs-line">${localize(key)}</div>
    </div>
  `;
}

function renderBlindResult(totals) {
  const title = totals.length === 1 ? localize("blindResult.titleOne") : localize("blindResult.titleMany");
  const label = totals.length === 1 ? localize("blindResult.labelOne") : localize("blindResult.labelMany");
  const value = totals.map(formatTotal).join(", ");

  return `
    <div class="rgs-card rgs-blind-result">
      <div class="rgs-kicker"><i class="fas fa-eye-slash"></i> ${title}</div>
      <div class="rgs-total-label">${label}</div>
      <div class="rgs-total">${value}</div>
    </div>
  `;
}

function renderPlayerBlindStub(authorName) {
  return `
    <div class="rgs-card rgs-player-blind-stub">
      <div class="rgs-kicker"><i class="fas fa-eye-slash"></i> ${localize("playerBlindStub.title")}</div>
      <div class="rgs-line">${format("playerBlindStub.line", { name: authorName })}</div>
    </div>
  `;
}

function renderSanitizedBlindCard(sourceMessage) {
  const content = String(sourceMessage.content ?? "").trim();
  if (!content || typeof DOMParser === "undefined") return null;
  if (!getTotalsFromContent(content).length) return null;

  const document = new DOMParser().parseFromString(content, "text/html");
  const body = document.body;
  if (!body?.innerHTML?.trim()) return null;

  sanitizeBlindCard(body, document);

  const sanitized = body.innerHTML.trim();
  return sanitized ? `<div class="rgs-sanitized-card">${sanitized}</div>` : null;
}

function sanitizeBlindCard(root, document) {
  root.querySelectorAll("script, style, template").forEach((element) => element.remove());
  root.querySelectorAll([
    ".dice-tooltip",
    ".dice-formula",
    ".dice-details",
    ".dice-breakdown",
    ".roll-details",
    ".roll-breakdown",
    ".dice-rolls",
    ".card-buttons",
    ".card-button-group",
    ".difficulty-class",
    ".gm-sensitive",
    "[data-gm-sensitive-uuid]",
    "[data-gm-sensitive-inner]",
    "a.inline-action",
    "button[data-action]"
  ].join(", ")).forEach((element) => element.remove());

  root.querySelectorAll(".dice-total, .roll-total").forEach((element) => sanitizeRollTotalElement(element));
  root.querySelectorAll(".inline-roll, .inline-result, .fake-inline-roll").forEach((element) => replaceRollElementWithTotal(element, document));
  root.querySelectorAll("*").forEach((element) => sanitizeBlindCardAttributes(element));
}

function sanitizeRollTotalElement(element) {
  const total = getRollTotalFromElement(element)
    ?? parseSingleNumber(element.dataset?.total)
    ?? parseSingleNumber(element.querySelector?.(".total")?.textContent)
    ?? parseSingleNumber(element.textContent);

  element.querySelectorAll(".natural, .bonus, .equals").forEach((child) => child.remove());

  const totalElement = element.querySelector?.(".total");
  if (totalElement && Number.isFinite(total)) totalElement.textContent = formatTotal(total);
  else if (Number.isFinite(total)) element.textContent = formatTotal(total);
}

function replaceRollElementWithTotal(element, document) {
  const total = getRollTotalFromElement(element)
    ?? parseSingleNumber(element.dataset?.total)
    ?? parseSingleNumber(element.dataset?.result)
    ?? parseSingleNumber(element.textContent);

  const replacement = document.createElement("span");
  replacement.className = getStaticRollClassName(element);
  replacement.textContent = Number.isFinite(total) ? formatTotal(total) : String(element.textContent ?? "").trim();
  element.replaceWith(replacement);
}

function getStaticRollClassName(element) {
  const classes = Array.from(element.classList ?? [])
    .filter((className) => !["inline-roll", "fake-inline-roll"].includes(className));

  classes.push("rgs-static-roll");
  return Array.from(new Set(classes)).join(" ");
}

function sanitizeBlindCardAttributes(element) {
  for (const attribute of Array.from(element.attributes ?? [])) {
    const name = attribute.name.toLowerCase();

    if (name.startsWith("on")) {
      element.removeAttribute(attribute.name);
      continue;
    }

    if ([
      "data-roll",
      "data-tooltip",
      "data-tooltip-text",
      "data-formula",
      "data-natural",
      "data-bonus",
      "data-dc",
      "data-action",
      "data-value",
      "data-ratio",
      "data-tags",
      "title",
      "aria-describedby"
    ].includes(name)) {
      element.removeAttribute(attribute.name);
    }
  }
}

function inferMessageMode(message, options = {}) {
  const rawMode = options.messageMode
    ?? options.rollMode
    ?? message.getFlag?.("core", "messageMode")
    ?? message.getFlag?.("core", "rollMode");

  if (!rawMode) return null;

  const mode = String(rawMode).toLowerCase();
  if (["public", "publicroll"].includes(mode)) return "public";
  if (["gm", "gmroll", "private"].includes(mode)) return "gm";
  if (["blind", "blindroll"].includes(mode)) return "blind";
  if (["self", "selfroll"].includes(mode)) return "self";

  return null;
}

function shouldHideOriginalGmOnlyRoll(message) {
  if (!game.settings.get(MODULE_ID, SETTINGS.enabled)) return false;
  if (game.user.isGM) return false;
  if (message.getFlag(MODULE_ID, FLAGS.synthetic)) return false;
  if (isPlayerAuthoredBlindGmRoll(message)) return isRollMessage(message);
  if (!isGmAuthoredMessage(message)) return false;
  if (!isRollMessage(message)) return false;

  return isBlindGmOnlyRoll(message) || isPrivateGmOnlyRoll(message);
}

function isRollMessage(message) {
  return Boolean(message.isRoll) || getRolls(message).length > 0 || isProbablyRollContent(message.content);
}

function isPrivateGmOnlyRoll(message) {
  if (message.blind) return false;

  const whisper = getWhisperIds(message);
  if (!whisper.length) return false;

  return whisper.every((id) => game.users.get(id)?.isGM);
}

function isBlindGmOnlyRoll(message) {
  if (!message.blind) return false;

  const whisper = getWhisperIds(message);
  if (!whisper.length) return false;

  return whisper.every((id) => game.users.get(id)?.isGM);
}

function isPlayerAuthoredBlindGmRoll(message, options = {}) {
  if (!isRollMessage(message)) return false;
  if (!getMessageUserId(message)) return false;
  if (isGmAuthoredMessage(message)) return false;

  const mode = inferMessageMode(message, options);
  const isBlind = mode === "blind" || Boolean(message.blind);
  if (!isBlind) return false;

  const whisper = getWhisperIds(message);
  if (!whisper.length) return mode === "blind";

  return whisper.every((id) => game.users.get(id)?.isGM);
}

function getWhisperIds(message) {
  const whisper = Array.from(message.whisper ?? []);

  return whisper
    .map((recipient) => typeof recipient === "string" ? recipient : recipient?.id)
    .filter(Boolean);
}

function isGmAuthoredMessage(message, { defaultToCurrentGm = false } = {}) {
  const userId = getMessageUserId(message);
  if (!userId) return defaultToCurrentGm && game.user.isGM;

  return Boolean(game.users.get(userId)?.isGM);
}

function getMessageUserId(message) {
  const user = message.user ?? message.author;
  if (typeof user === "string") return user;
  return user?.id;
}

function getMessageAuthorName(message) {
  const userId = getMessageUserId(message);
  const user = userId ? game.users.get(userId) : null;

  return user?.name ?? user?.character?.name ?? message.speaker?.alias ?? localize("speaker.player");
}

function getRolls(message) {
  const directRolls = message.rolls ?? (message.roll ? [message.roll] : []);
  const rolls = Array.from(directRolls).map(normalizeRoll).filter(Boolean);
  if (rolls.length) return rolls;

  const sourceRolls = message.toObject?.(false)?.rolls;
  return Array.isArray(sourceRolls) ? sourceRolls.map(normalizeRoll).filter(Boolean) : [];
}

function normalizeRoll(roll) {
  if (!roll) return null;
  if (typeof roll !== "string") return roll;

  const decoded = decodeSerializedRoll(roll);

  try {
    return JSON.parse(decoded);
  } catch (error) {
    debug("Could not parse serialized roll", { error });
    return null;
  }
}

function getDiceCount(message) {
  const rollDiceCount = countRolledDice(getRolls(message));
  if (rollDiceCount > 0) return rollDiceCount;

  const contentDiceCount = countDiceInContent(message.content);
  return contentDiceCount > 0 ? contentDiceCount : null;
}

function countRolledDice(rolls) {
  return rolls.reduce((total, roll) => total + countDiceInRoll(roll), 0);
}

function countDiceInRoll(roll) {
  if (Array.isArray(roll.dice) && roll.dice.length) {
    return roll.dice.reduce((total, die) => total + countDiceTerm(die), 0);
  }

  if (Array.isArray(roll.terms)) {
    return roll.terms.reduce((total, term) => total + countDiceTerm(term), 0);
  }

  return 0;
}

function countDiceTerm(term) {
  if (!term || typeof term !== "object") return 0;

  if (Array.isArray(term.results)) return term.results.length;
  if (Number.isFinite(term.faces) && Number.isFinite(term.number)) return term.number;

  const nestedTerms = Array.isArray(term.terms) ? term.terms : [];
  return nestedTerms.reduce((total, nestedTerm) => total + countDiceTerm(nestedTerm), 0);
}

function getRollTotal(roll) {
  const total = roll?.total ?? roll?._total;
  const numericTotal = Number(total);
  return Number.isFinite(numericTotal) ? numericTotal : null;
}

function getRollTotals(message) {
  const rollTotals = getRolls(message).map(getRollTotal).filter((total) => total !== null);
  if (rollTotals.length) return uniqueNumbers(rollTotals);

  const deepTotals = getTotalsFromStructuredData(message.raw ?? message);
  if (deepTotals.length) return uniqueNumbers(deepTotals);

  return getTotalsFromContent(message.content);
}

function sourceKeyFromMessage(message) {
  if (message?.id) return `message:${message.id}`;

  const rollId = getRolls(message)[0]?.id;
  return rollId ? `roll:${rollId}` : null;
}

function hasPostedSource(sourceKey) {
  return Boolean(sourceKey && postedSources.has(sourceKey));
}

function markPostedSource(sourceKey) {
  if (!sourceKey) return;
  postedSources.add(sourceKey);
}

function formatTotal(total) {
  return Number.isInteger(total) ? String(total) : String(Number(total.toFixed(2)));
}

function getDiceCountBucket(count) {
  if (count === 1) return "oneDie";
  if (count >= 2 && count <= 4) return "fewDice";
  return "manyDice";
}

function localize(key) {
  return game.i18n.localize(`${MODULE_ID}.${key}`);
}

function format(key, data = {}) {
  return game.i18n.format(`${MODULE_ID}.${key}`, data);
}

function debug(message, data = {}) {
  if (!game.settings.get(MODULE_ID, SETTINGS.debug)) return;
  console.debug(`${MODULE_ID} | ${message}`, data);
}

function isSyntheticMessageCreator() {
  if (!game.user.isGM) return false;

  const gms = getUsers()
    .filter((user) => user.isGM)
    .sort((left, right) => left.id.localeCompare(right.id));
  const activeGms = gms.filter((user) => user.active);
  const candidates = activeGms.length ? activeGms : gms;

  return candidates[0]?.id === game.user.id;
}

function isProbablyRollContent(content = "") {
  if (!content) return false;

  return /(?:\b\d*d\d+\b|dice-roll|dice-total|inline-roll|data-roll|data-formula|data-dice|roll\b|attack|damage)/i.test(content);
}

function countDiceInContent(content = "") {
  if (!content) return 0;

  const formulas = new Set();
  const formulaPattern = /\b(\d*)d(\d+)\b/gi;
  for (const match of content.matchAll(formulaPattern)) {
    formulas.add(match[0].toLowerCase());
  }

  let diceCount = 0;
  for (const formula of formulas) {
    const matches = formula.matchAll(/\b(\d*)d\d+\b/gi);
    for (const match of matches) {
      diceCount += Number.parseInt(match[1] || "1", 10);
    }
  }

  return diceCount;
}

function getTotalsFromContent(content = "") {
  if (!content) return [];

  const document = new DOMParser().parseFromString(content, "text/html");
  const totalNodes = document.querySelectorAll([
    ".dice-total",
    ".total",
    ".roll-total",
    ".roll-result",
    ".result",
    ".target",
    ".damage-total",
    ".attack-total",
    ".inline-result",
    ".inline-roll",
    "[data-total]",
    "[data-result]",
    "[data-roll-total]",
    "[data-roll]"
  ].join(", "));
  const totals = [];

  for (const node of totalNodes) {
    const rollTotal = getRollTotalFromElement(node);
    if (Number.isFinite(rollTotal)) {
      totals.push(rollTotal);
      continue;
    }

    const raw = node.dataset?.total
      ?? node.dataset?.result
      ?? node.dataset?.rollTotal
      ?? node.textContent;
    const total = parseSingleNumber(raw);
    if (Number.isFinite(total)) totals.push(total);
  }

  if (totals.length) return uniqueNumbers(totals);

  return uniqueNumbers(getLabeledTotalsFromText(document.body?.textContent ?? ""));
}

function getRollTotalFromElement(node) {
  const rollData = node.dataset?.roll;
  if (!rollData) return null;

  const roll = normalizeRoll(rollData);
  return roll ? getRollTotal(roll) : null;
}

function getTotalsFromStructuredData(value) {
  const totals = [];
  const seen = new WeakSet();

  collectTotals(value, totals, seen, []);
  return uniqueNumbers(totals);
}

function collectTotals(value, totals, seen, path) {
  if (value === null || value === undefined) return;

  if (typeof value === "string") {
    const parsed = maybeParseJson(value);
    if (parsed && parsed !== value) {
      collectTotals(parsed, totals, seen, path);
      return;
    }

    if (pathLooksLikeTotal(path)) {
      const total = parseSingleNumber(value);
      if (Number.isFinite(total)) totals.push(total);
    }

    return;
  }

  if (typeof value !== "object") {
    if (pathLooksLikeTotal(path)) {
      const total = Number(value);
      if (Number.isFinite(total)) totals.push(total);
    }
    return;
  }

  if (seen.has(value)) return;
  seen.add(value);

  const directRollTotal = getRollTotal(value);
  if (directRollTotal !== null && looksLikeRollObject(value)) totals.push(directRollTotal);

  for (const [key, child] of Object.entries(value)) {
    if (shouldSkipDeepKey(key)) continue;

    const nextPath = [...path, key];
    if (pathLooksLikeTotal(nextPath)) {
      const total = parseSingleNumber(child);
      if (Number.isFinite(total)) {
        totals.push(total);
        continue;
      }
    }

    collectTotals(child, totals, seen, nextPath);
  }
}

function looksLikeRollObject(value) {
  return Array.isArray(value?.dice)
    || Array.isArray(value?.terms)
    || Array.isArray(value?.results)
    || typeof value?.formula === "string"
    || typeof value?._formula === "string";
}

function pathLooksLikeTotal(path) {
  if (!path.length) return false;

  const last = String(path.at(-1)).toLowerCase();
  const joined = path.join(".").toLowerCase();

  if (["total", "_total", "result", "rolltotal", "roll-total"].includes(last)) return true;
  if (/(^|\.)(attack|damage|save|check|skill|roll)\.(total|result)$/i.test(joined)) return true;
  if (/(^|\.)(total|result)$/i.test(joined) && /(?:roll|dice|attack|damage|save|check|skill|card|action)/i.test(joined)) return true;

  return false;
}

function shouldSkipDeepKey(key) {
  return [
    "content",
    "flavor",
    "description",
    "img",
    "src",
    "uuid",
    "id",
    "_id",
    "dice",
    "terms",
    "results"
  ].includes(String(key).toLowerCase());
}

function maybeParseJson(value) {
  const trimmed = decodeSerializedRoll(value).trim();
  if (!trimmed || !["{", "["].includes(trimmed[0])) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function decodeSerializedRoll(value) {
  if (typeof value !== "string") return value;

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseSingleNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const normalized = value.trim().replace(",", ".");
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) return null;

  const total = Number(normalized);
  return Number.isFinite(total) ? total : null;
}

function getLabeledTotalsFromText(text = "") {
  const totals = [];
  const patterns = [
    /\b(?:result|total)\s*:?\s*([+-]?\d+(?:[.,]\d+)?)/gi,
    /\b(?:attack|damage|save|check)\s*(?:#\d+)?\s*:?\s*([+-]?\d+(?:[.,]\d+)?)/gi
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const total = parseSingleNumber(match[1]);
      if (Number.isFinite(total)) totals.push(total);
    }
  }

  return totals;
}

function uniqueNumbers(values) {
  const seen = new Set();
  const unique = [];

  for (const value of values) {
    const key = String(value);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }

  return unique;
}

function buildSourceMessageFromCreateData(data = {}, createdMessage = null) {
  if (!data && !createdMessage) return null;
  data = data ?? {};

  const createdObject = createdMessage?.toObject?.(false) ?? {};
  const raw = {
    data,
    created: createdObject
  };

  return {
    id: createdMessage?.id ?? data._id ?? data.id ?? createdObject._id ?? createdObject.id,
    user: data.user ?? createdMessage?.user ?? createdMessage?.author ?? createdObject.user ?? createdObject.author,
    speaker: data.speaker ?? createdMessage?.speaker ?? createdObject.speaker,
    blind: data.blind ?? createdMessage?.blind ?? createdObject.blind ?? false,
    whisper: data.whisper ?? createdMessage?.whisper ?? createdObject.whisper ?? [],
    roll: data.roll ?? createdMessage?.roll ?? createdObject.roll,
    rolls: data.rolls ?? createdMessage?.rolls ?? createdObject.rolls ?? [],
    content: data.content ?? createdMessage?.content ?? createdObject.content ?? "",
    raw,
    getFlag: (scope, key) => data.flags?.[scope]?.[key]
      ?? createdMessage?.getFlag?.(scope, key)
      ?? createdObject.flags?.[scope]?.[key]
  };
}

function getUsers() {
  if (Array.isArray(game.users?.contents)) return game.users.contents;
  if (typeof game.users?.filter === "function") return game.users.filter(() => true);
  if (typeof game.users?.values === "function") return Array.from(game.users.values());
  return [];
}
