const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require("discord.js");

const http = require("http");

// =====================================================
// ENVIRONMENT VARIABLES
// =====================================================

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const FALIX_API_KEY = process.env.FALIX_API_KEY;
const FALIX_SERVER_ID = process.env.FALIX_SERVER_ID;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const AI_MODEL = process.env.AI_MODEL || "openrouter/free";
const PORT = Number(process.env.PORT) || 10000;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || "";

const FALIX_API = "https://client.falixnodes.net/api/v2";

// =====================================================
// ENVIRONMENT CHECK
// =====================================================

if (typeof fetch !== "function") {
  throw new Error("Node.js 18+ is required because this bot uses fetch().");
}

const missing = [];

if (!DISCORD_TOKEN) missing.push("DISCORD_TOKEN");
if (!FALIX_API_KEY) missing.push("FALIX_API_KEY");
if (!FALIX_SERVER_ID) missing.push("FALIX_SERVER_ID");
if (!OPENROUTER_API_KEY) missing.push("OPENROUTER_API_KEY");

if (missing.length) {
  throw new Error(`Missing environment variable(s): ${missing.join(", ")}`);
}

// =====================================================
// GLOBAL STATE
// =====================================================

let powerActionRunning = false;

// =====================================================
// DISCORD CLIENT
// =====================================================

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// =====================================================
// HTTP HEALTH SERVER
// =====================================================

const httpServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });

    res.end(
      JSON.stringify({
        status: "ok",
        service: "MoonShotSMP Bot",
        discord: client.isReady() ? "connected" : "connecting"
      })
    );

    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

// =====================================================
// HELPERS
// =====================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function truncate(value, maxLength, fallback = "N/A") {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const text = String(value);

  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function getValue(object, paths, fallback = null) {
  for (const path of paths) {
    const parts = path.split(".");
    let value = object;

    for (const part of parts) {
      if (value === undefined || value === null) {
        value = undefined;
        break;
      }

      value = value[part];
    }

    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return fallback;
}

function formatUptime(seconds) {
  const total = Number(seconds);

  if (!Number.isFinite(total) || total < 0) {
    return "N/A";
  }

  let s = Math.floor(total);

  const days = Math.floor(s / 86400);
  s %= 86400;

  const hours = Math.floor(s / 3600);
  s %= 3600;

  const minutes = Math.floor(s / 60);
  s %= 60;

  const parts = [];

  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);

  if (!parts.length || s) {
    parts.push(`${s}s`);
  }

  return parts.join(" ");
}

// =====================================================
// SERVER STATE
// =====================================================

function normalizeState(status) {
  if (!status || typeof status !== "object") {
    return "unknown";
  }

  let raw = getValue(
    status,
    [
      "state",
      "status",
      "server_state",
      "current_state"
    ],
    null
  );

  // Handle lifecycle_status safely
  if (raw == null) {
    const lifecycle = status.lifecycle_status;

    if (typeof lifecycle === "string") {
      raw = lifecycle;
    } else if (lifecycle && typeof lifecycle === "object") {
      raw =
        lifecycle.state ??
        lifecycle.status ??
        lifecycle.name ??
        lifecycle.value ??
        lifecycle.current_state ??
        null;
    }
  }

  if (raw == null) {
    return "unknown";
  }

  const state = String(raw)
    .toLowerCase()
    .trim()
    .replace(/[-\s]+/g, "_");

  const onlineStates = new Set([
    "online",
    "running",
    "started",
    "ready",
    "active"
  ]);

  const startingStates = new Set([
    "starting",
    "booting",
    "queued",
    "installing",
    "restoring",
    "reinstalling",
    "provisioning",
    "pending_start"
  ]);

  const stoppingStates = new Set([
    "stopping",
    "shutting_down",
    "shutdown",
    "pending_stop"
  ]);

  const offlineStates = new Set([
    "offline",
    "stopped",
    "dead",
    "crashed",
    "failed",
    "terminated",
    "storage"
  ]);

  if (onlineStates.has(state)) return "online";
  if (startingStates.has(state)) return "starting";
  if (stoppingStates.has(state)) return "stopping";
  if (offlineStates.has(state)) return "offline";

  return state || "unknown";
}

function stateDisplay(status) {
  const state = normalizeState(status);

  if (state === "online") {
    return { emoji: "🟢", text: "ONLINE", color: 0x57F287 };
  }

  if (state === "starting") {
    return { emoji: "🟡", text: "STARTING", color: 0xFEE75C };
  }

  if (state === "stopping") {
    return { emoji: "🟠", text: "STOPPING", color: 0xFEE75C };
  }

  if (state === "offline") {
    return { emoji: "🔴", text: "OFFLINE", color: 0xED4245 };
  }

  return { emoji: "⚪", text: String(state).toUpperCase(), color: 0x95A5A6 };
}

// =====================================================
// PLAYER COUNT
// =====================================================

function getPlayerCount(status, server) {
  let online = getValue(
    status,
    ["players.online", "players.current", "player_count", "online_players"],
    null
  );

  let max = getValue(status, ["players.max", "players.maximum", "max_players"], null);

  if (typeof status?.players === "number") {
    online = status.players;
  }

  if (status?.players && typeof status.players === "object") {
    online ??= status.players.online ?? status.players.current ?? null;
    max ??= status.players.max ?? status.players.maximum ?? null;
  }

  max ??= getValue(server, ["players.max", "max_players"], null);

  const o = Number(online);
  const m = Number(max);

  if (Number.isFinite(o) && Number.isFinite(m)) {
    return `${o} / ${m}`;
  }

  if (online !== null && online !== undefined) {
    return String(online);
  }

  return "N/A";
}

// =====================================================
// SERVER ADDRESS
// =====================================================

function getAddress(server, status) {
  return getValue(
    server,
    [
      "address",
      "connection.address",
      "allocation.address",
      "primary_allocation.address",
      "network.address",
      "connection.ip"
    ],
    getValue(status, ["address", "connection.address", "allocation.address"], "N/A")
  );
}

// =====================================================
// SERVER VERSION
// =====================================================

function getVersion(server, status) {
  return getValue(
    server,
    ["version", "game.version", "software.version", "application.version", "egg.version"],
    getValue(status, ["version", "software.version"], "N/A")
  );
}

// =====================================================
// FALIX API
// =====================================================

async function falixRequest(endpoint, options = {}) {
  const url = `${FALIX_API}${endpoint}`;

  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${FALIX_API_KEY}`,
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {})
  };

  console.log(`[Falix] ${options.method || "GET"} ${endpoint}`);

  let response;

  try {
    response = await fetch(url, {
      ...options,
      headers,
      signal: AbortSignal.timeout(20000)
    });
  } catch (error) {
    const e = new Error("Could not connect to Falix API.");
    e.code = "network_error";
    e.cause = error;
    throw e;
  }

  const raw = await response.text();

  let data = {};

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  if (!response.ok) {
    const apiError = data?.error || {};

    const error = new Error(
      apiError.message || data?.message || `Falix API returned HTTP ${response.status}`
    );

    error.httpStatus = response.status;
    error.code = apiError.code || data?.code || null;
    error.actionUrl = apiError.action_url || data?.action_url || null;
    error.docUrl = apiError.doc_url || null;
    error.requestId =
      apiError.request_id ||
      data?.request_id ||
      response.headers.get("x-request-id") ||
      null;
    error.response = data;

    console.error("[Falix] API ERROR", {
      status: error.httpStatus,
      code: error.code,
      message: error.message,
      requestId: error.requestId
    });

    throw error;
  }

  return data?.data ?? data;
}

// =====================================================
// FALIX FUNCTIONS
// =====================================================

async function getServerInfo() {
  return falixRequest(`/servers/${encodeURIComponent(FALIX_SERVER_ID)}`);
}

async function getServerStatus() {
  return falixRequest(`/servers/${encodeURIComponent(FALIX_SERVER_ID)}/status`);
}

async function getFalixMe() {
  return falixRequest("/me");
}

async function powerServer(signal) {
  if (!["start", "stop", "restart"].includes(signal)) {
    throw new Error("Invalid power signal.");
  }

  const idempotencyKey = `moonshot-${FALIX_SERVER_ID}-${signal}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;

  return falixRequest(`/servers/${encodeURIComponent(FALIX_SERVER_ID)}/power`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ signal })
  });
}

// =====================================================
// FALIX ERROR HANDLING
// =====================================================

function formatFalixError(error, action = "power") {
  if (error.code === "ad_required") {
    let text = "⚠️ **Falix requires an ad/action before this server can be started.**";

    if (error.actionUrl) {
      text += `\n\n🔗 ${error.actionUrl}`;
    }

    return text;
  }

  if (error.code === "free_plan_restricted") {
    return "⚠️ **This Falix power action is restricted on the current plan.**";
  }

  if (error.code === "unauthorized" || error.httpStatus === 401) {
    return "🔑 **Falix API key is invalid/expired/revoked or blocked.** Check the key.";
  }

  if (error.code === "forbidden" || error.httpStatus === 403) {
    return "🔒 **Falix rejected the request. Make sure the API key has `servers:power` and the required server control permission.**";
  }

  if (error.code === "not_found" || error.httpStatus === 404) {
    return "❌ **Falix server not found.** Check `FALIX_SERVER_ID`.";
  }

  if (error.code === "conflict" || error.httpStatus === 409) {
    return `⚠️ **Falix says the server is in a conflicting state.**\n\n${truncate(
      error.message,
      1000
    )}`;
  }

  if (error.code === "rate_limit_exceeded" || error.httpStatus === 429) {
    return "⏳ **Falix API rate limit reached.** Try again shortly.";
  }

  if (error.httpStatus >= 500) {
    return "🔴 **Falix returned a server-side error.** Try again later.";
  }

  if (error.code === "network_error") {
    return "🌐 **Could not connect to Falix.** Try again shortly.";
  }

  return `❌ **Failed to ${action} the server.**\n\n\`${truncate(
    error.message || "Unknown Falix error",
    1000
  )}\``;
}

// =====================================================
// PANEL
// =====================================================

async function buildPanel() {
  const [server, status] = await Promise.all([getServerInfo(), getServerStatus()]);

  const state = stateDisplay(status);
  const rawState = normalizeState(status);

  const serverName = truncate(
    getValue(server, ["name", "server_name"], "MoonShotSMP"),
    200,
    "MoonShotSMP"
  );

  const version = truncate(getVersion(server, status), 100);

  const address = truncate(String(getAddress(server, status)).replace(/`/g, "'"), 1000);

  const uptime = getValue(status, ["uptime", "uptime_seconds"], null);

  let uptimeText = "Server is offline";

  if (rawState === "online") {
    uptimeText = formatUptime(uptime);
  } else if (rawState === "starting") {
    uptimeText = "Server is starting...";
  } else if (rawState === "stopping") {
    uptimeText = "Server is stopping...";
  } else if (rawState !== "offline") {
    uptimeText = "Status unavailable";
  }

  const embed = new EmbedBuilder()
    .setColor(state.color)
    .setTitle(`🚀 ${serverName} Server Control Panel`)
    .setDescription(`${state.emoji} **${state.text}**\n━━━━━━━━━━━━━━━━━━━━`)
    .addFields(
      {
        name: "👥 Player Count",
        value: `**${getPlayerCount(status, server)}**`,
        inline: true
      },
      {
        name: "🎮 Version",
        value: `**${version}**`,
        inline: true
      },
      {
        name: "⏱️ Uptime",
        value: `**${truncate(uptimeText, 1000)}**`,
        inline: false
      },
      {
        name: "🌐 Connection Address",
        value: `\`${address}\``,
        inline: false
      }
    )
    .setFooter({ text: "MoonShotSMP • Falix Minecraft Server" })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("minecraft_start")
      .setLabel("Start")
      .setEmoji("▶️")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("minecraft_stop")
      .setLabel("Stop")
      .setEmoji("⏹️")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId("minecraft_restart")
      .setLabel("Restart")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("minecraft_refresh")
      .setLabel("Refresh")
      .setEmoji("🔃")
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

// =====================================================
// PANEL REFRESH
// =====================================================

async function refreshPanelMessage(message, delay = 0) {
  if (delay) {
    await sleep(delay);
  }

  try {
    await message.edit(await buildPanel());
    console.log("Panel refreshed.");
    return true;
  } catch (error) {
    console.error("Panel refresh failed:", error);
    return false;
  }
}

// =====================================================
// PANEL POLLING AFTER POWER ACTION
// =====================================================

async function refreshPanelUntilStable(message, maxAttempts = 8) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(attempt === 1 ? 4000 : 5000);

    try {
      await refreshPanelMessage(message);

      const status = await getServerStatus();
      const state = normalizeState(status);

      console.log(`Power-action poll ${attempt}/${maxAttempts}: ${state}`);

      if (state === "online" || state === "offline") {
        await refreshPanelMessage(message);
        return state;
      }
    } catch (error) {
      console.error(`Power-action poll ${attempt} failed:`, error.message);
    }
  }

  await refreshPanelMessage(message);
  return "timeout";
}

// =====================================================
// OPENROUTER AI
// =====================================================

async function askAI(question) {
  let response;

  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",

      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://discord.com/",
        "X-Title": "MoonShotSMP Discord Bot"
      },

      body: JSON.stringify({
        model: AI_MODEL,

        messages: [
          {
            role: "system",
            content:
              "You are MoonShotSMP's Discord AI assistant. " +
              "Be helpful, concise and friendly. " +
              "Answer in casual Hinglish when appropriate. " +
              "Never claim live server status unless the bot provides it."
          },
          {
            role: "user",
            content: question
          }
        ],

        temperature: 0.7,
        max_tokens: 500
      }),

      signal: AbortSignal.timeout(30000)
    });
  } catch (cause) {
    const error = new Error("Could not connect to OpenRouter.");
    error.code = "openrouter_network_error";
    error.cause = cause;
    throw error;
  }

  const raw = await response.text();

  let data = {};

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  if (!response.ok) {
    const error = new Error(
      data?.error?.message || `OpenRouter returned HTTP ${response.status}`
    );

    error.httpStatus = response.status;
    error.code = data?.error?.code || null;
    error.response = data;

    throw error;
  }

  const answer = data?.choices?.[0]?.message?.content;

  if (!answer) {
    throw new Error("OpenRouter returned an empty response.");
  }

  return String(answer).trim();
}

// =====================================================
// ASK COMMAND LOGIC
// =====================================================

async function answerQuestion(question) {
  const q = question.toLowerCase().trim();

  if (
    q === "status" ||
    q === "online" ||
    q.includes("server status") ||
    q.includes("is the server online")
  ) {
    try {
      const [server, status] = await Promise.all([getServerInfo(), getServerStatus()]);
      const state = stateDisplay(status);

      return {
        title: "🎮 MoonShotSMP Server",
        description:
          `${state.emoji} **${state.text}**\n\n` +
          `👥 Players: **${getPlayerCount(status, server)}**`
      };
    } catch (error) {
      return {
        title: "❌ Server Status",
        description: `I couldn't fetch the server status.\n\n${truncate(error.message, 1000)}`
      };
    }
  }

  if (
    q === "ip" ||
    q.includes("server ip") ||
    q.includes("server address") ||
    q.includes("minecraft ip") ||
    q.includes("how do i connect")
  ) {
    try {
      const [server, status] = await Promise.all([getServerInfo(), getServerStatus()]);

      return {
        title: "🌐 Minecraft Connection",
        description: `Server Address:\n\`${truncate(String(getAddress(server, status)), 1000)}\``
      };
    } catch (error) {
      return {
        title: "❌ Connection Info",
        description: `I couldn't retrieve the server address.\n\n${truncate(error.message, 1000)}`
      };
    }
  }

  if (q === "help" || q === "commands" || q.includes("what commands")) {
    return {
      title: "🤖 MoonShotSMP Help",
      description:
        "**Available commands:**\n\n" +
        "`/panel` — Minecraft server control panel\n" +
        "`/ask` — Ask the AI assistant"
    };
  }

  return {
    title: "🤖 MoonShotSMP AI",
    description: await askAI(question)
  };
}

// =====================================================
// COMMAND REGISTRATION
// =====================================================

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("panel")
      .setDescription("Show the Minecraft server control panel")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
      .setDMPermission(false)
      .toJSON(),

    new SlashCommandBuilder()
      .setName("ask")
      .setDescription("Ask the MoonShotSMP AI assistant")
      .addStringOption(option =>
        option
          .setName("question")
          .setDescription("Your question")
          .setRequired(true)
          .setMaxLength(500)
      )
      .setDMPermission(false)
      .toJSON()
  ];

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  if (DISCORD_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(client.user.id, DISCORD_GUILD_ID), {
      body: commands
    });

    console.log(`Registered commands in guild ${DISCORD_GUILD_ID}.`);
  } else {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

    console.log("Registered global commands.");
    console.log("Tip: set DISCORD_GUILD_ID for instant command updates during testing.");
  }
}

// =====================================================
// STARTUP DIAGNOSTICS
// =====================================================

async function runStartupChecks() {
  console.log("Running Falix startup check...");

  try {
    const me = await getFalixMe();
    const scopes = me?.key?.scopes || [];

    console.log("Falix API key valid.");
    console.log("Falix scopes:", scopes.join(", ") || "none reported");

    if (
      !scopes.includes("*") &&
      !scopes.includes("servers:*") &&
      !scopes.includes("servers:power")
    ) {
      console.warn("WARNING: API key may not have the servers:power scope.");
    }
  } catch (error) {
    console.error("Falix /me check failed:", error.message);

    if (error.requestId) {
      console.error("Falix request ID:", error.requestId);
    }
  }

  try {
    const status = await getServerStatus();
    console.log("Falix server state:", normalizeState(status));
  } catch (error) {
    console.error("Falix server status check failed:", error.message);
  }
}

// =====================================================
// DISCORD READY
// =====================================================

client.once("clientReady", async () => {
  console.log("========================================");
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Falix Server ID: ${FALIX_SERVER_ID}`);
  console.log(`AI Model: ${AI_MODEL}`);
  console.log("========================================");

  try {
    await registerCommands();
  } catch (error) {
    console.error("Command registration failed:", error);
  }

  await runStartupChecks();
});

// =====================================================
// INTERACTIONS
// =====================================================

client.on("interactionCreate", async interaction => {
  try {
    // =================================================
    // SLASH COMMANDS
    // =================================================

    if (interaction.isChatInputCommand()) {
      // ===============================================
      // /panel
      // ===============================================

      if (interaction.commandName === "panel") {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.reply({
            content: "🔒 **You need Manage Server permission to use `/panel`.**",
            ephemeral: true
          });

          return;
        }

        await interaction.deferReply();

        try {
          await interaction.editReply(await buildPanel());
        } catch (error) {
          console.error("Panel error:", error);

          await interaction.editReply({
            content: `❌ **Failed to load Falix server information.**\n\n${truncate(
              error.message,
              1000
            )}`
          });
        }

        return;
      }

      // ===============================================
      // /ask
      // ===============================================

      if (interaction.commandName === "ask") {
        const question = interaction.options.getString("question", true);

        await interaction.deferReply();

        try {
          const answer = await answerQuestion(question);

          const description = truncate(
            answer.description || "No response.",
            4096,
            "No response."
          );

          const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(truncate(answer.title, 256, "MoonShotSMP AI"))
            .setDescription(description)
            .setFooter({ text: truncate(`MoonShotSMP AI • ${AI_MODEL}`, 2048) })
            .setTimestamp();

          await interaction.editReply({ embeds: [embed] });
        } catch (error) {
          let message = "❌ **AI request failed.**";

          if (error.httpStatus === 401) {
            message = "❌ **OpenRouter API key is invalid or expired.**";
          } else if (error.httpStatus === 402) {
            message = "❌ **Selected OpenRouter model/provider is unavailable for this request.**";
          } else if (error.httpStatus === 403) {
            message = "🔒 **OpenRouter rejected the request. Check the API key permissions.**";
          } else if (error.httpStatus === 429) {
            message = "⏳ **OpenRouter rate limit reached.**";
          } else if (error.httpStatus >= 500) {
            message = "🔴 **OpenRouter server-side error.**";
          } else if (error.code === "openrouter_network_error") {
            message = "🌐 **Could not connect to OpenRouter.**";
          }

          await interaction.editReply({
            content: `${message}\n\n\`${truncate(error.message, 1000)}\``
          });
        }

        return;
      }

      return;
    }

    // =================================================
    // BUTTONS
    // =================================================

    if (!interaction.isButton()) {
      return;
    }

    // ===============================================
    // REFRESH
    // ===============================================
    // FIX: handled before the permission gate below so that
    // anyone who can see the panel can refresh it. Only the
    // power actions (start/stop/restart) require Manage Server.

    if (interaction.customId === "minecraft_refresh") {
      await interaction.deferUpdate();
      await refreshPanelMessage(interaction.message);
      return;
    }

    // ===============================================
    // EVERYTHING BELOW THIS POINT REQUIRES MANAGE SERVER
    // ===============================================

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: "🔒 **You need Manage Server permission to use this control panel.**",
        ephemeral: true
      });

      return;
    }

    // ===============================================
    // POWER ACTIONS
    // ===============================================

    const actions = {
      minecraft_start: "start",
      minecraft_stop: "stop",
      minecraft_restart: "restart"
    };

    const action = actions[interaction.customId];

    if (!action) {
      return;
    }

    if (powerActionRunning) {
      await interaction.reply({
        content: "⏳ **Another server power action is already running. Please wait.**",
        ephemeral: true
      });

      return;
    }

    powerActionRunning = true;

    await interaction.deferReply({ ephemeral: true });

    try {
      const status = await getServerStatus();
      const currentState = normalizeState(status);

      console.log(`Button ${action.toUpperCase()} requested. Current state: ${currentState}`);

      // =============================================
      // START
      // =============================================

      if (action === "start") {
        if (currentState === "online") {
          await interaction.editReply({ content: "🟢 **Server is already online.**" });
          return;
        }

        if (currentState === "starting") {
          await interaction.editReply({ content: "🟡 **Server is already starting.**" });
          return;
        }

        if (currentState === "stopping") {
          await interaction.editReply({
            content: "🟠 **Server is currently stopping. Wait for it to finish.**"
          });
          return;
        }

        if (currentState !== "offline") {
          await interaction.editReply({
            content: `⚪ **Unknown server state:** \`${currentState}\``
          });
          return;
        }
      }

      // =============================================
      // STOP
      // =============================================

      if (action === "stop") {
        if (currentState === "offline") {
          await interaction.editReply({ content: "🔴 **Server is already offline.**" });
          return;
        }

        if (currentState === "stopping") {
          await interaction.editReply({ content: "🟠 **Server is already stopping.**" });
          return;
        }

        if (currentState === "starting") {
          await interaction.editReply({
            content: "🟡 **Server is currently starting. Wait for startup to finish.**"
          });
          return;
        }

        if (currentState !== "online") {
          await interaction.editReply({
            content: `⚪ **Unknown server state:** \`${currentState}\``
          });
          return;
        }
      }

      // =============================================
      // RESTART
      // =============================================

      if (action === "restart") {
        if (currentState === "offline") {
          await powerServer("start");

          await interaction.editReply({
            content:
              "✅ **Server was offline, so START was sent to Falix.**\n\n⏳ Refreshing panel shortly..."
          });
        } else if (currentState === "starting") {
          await interaction.editReply({ content: "🟡 **Server is already starting.**" });
          return;
        } else if (currentState === "stopping") {
          await interaction.editReply({
            content: "🟠 **Server is currently stopping. Wait for shutdown to finish.**"
          });
          return;
        } else if (currentState === "online") {
          await powerServer("restart");

          await interaction.editReply({
            content: "✅ **RESTART request sent to Falix.**\n\n⏳ Refreshing panel shortly..."
          });
        } else {
          await interaction.editReply({
            content: `⚪ **Unknown server state:** \`${currentState}\``
          });
          return;
        }
      } else {
        // ===========================================
        // START / STOP POWER REQUEST
        // ===========================================

        await powerServer(action);

        await interaction.editReply({
          content: `✅ **${action.toUpperCase()} request sent to Falix.**\n\n⏳ Refreshing panel shortly...`
        });
      }

      // =============================================
      // PANEL POLLING UNTIL STABLE
      // =============================================
      // FIX: this is now awaited (instead of a fire-and-forget
      // `.catch()`) so that `powerActionRunning` stays true for
      // the whole polling window. refreshPanelUntilStable never
      // throws (all its internal calls are self-catching), so no
      // extra try/catch is needed here.

      const panelMessage = interaction.message;

      await refreshPanelUntilStable(panelMessage);
    } catch (error) {
      console.error(`Failed to ${action}:`, error);

      await interaction.editReply({ content: formatFalixError(error, action) });
    } finally {
      powerActionRunning = false;
    }

    return;
  } catch (error) {
    console.error("Interaction handler error:", error);

    try {
      const content = "❌ **Something went wrong while processing this interaction.**";

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content });
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
    } catch {}

    powerActionRunning = false;
  }
});

// =====================================================
// DISCORD EVENTS
// =====================================================

client.on("error", error => console.error("Discord error:", error));
client.on("warn", warning => console.warn("Discord warning:", warning));

process.on("unhandledRejection", error => {
  console.error("Unhandled rejection:", error);
});

process.on("uncaughtException", async error => {
  console.error("Uncaught exception:", error);
  await shutdown("UNCAUGHT_EXCEPTION");
});

// =====================================================
// SHUTDOWN
// =====================================================

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;

  shuttingDown = true;

  console.log(`Received ${signal}. Shutting down...`);

  try {
    httpServer.close();
  } catch (error) {
    console.error("HTTP server shutdown error:", error);
  }

  try {
    client.destroy();
  } catch (error) {
    console.error("Discord shutdown error:", error);
  }

  process.exit(signal === "UNCAUGHT_EXCEPTION" ? 1 : 0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// =====================================================
// LOGIN
// =====================================================

console.log("Connecting to Discord...");

client.login(DISCORD_TOKEN).catch(error => {
  console.error("Discord login failed:", error);
  process.exit(1);
});
