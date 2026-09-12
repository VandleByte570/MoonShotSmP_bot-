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
// NODE.JS CHECK
// =====================================================

if (typeof fetch !== "function") {
  throw new Error(
    "❌ Node.js 18+ is required because this bot uses fetch()."
  );
}

// =====================================================
// ENVIRONMENT VARIABLES
// =====================================================

const token = process.env.DISCORD_TOKEN;
const falixKey = process.env.FALIX_API_KEY;
const serverId = process.env.FALIX_SERVER_ID;
const openRouterKey = process.env.OPENROUTER_API_KEY;

const aiModel =
  process.env.AI_MODEL || "openrouter/free";

const PORT =
  Number(process.env.PORT) || 10000;

// =====================================================
// ENVIRONMENT VALIDATION
// =====================================================

const missing = [];

if (!token) {
  missing.push("DISCORD_TOKEN");
}

if (!falixKey) {
  missing.push("FALIX_API_KEY");
}

if (!serverId) {
  missing.push("FALIX_SERVER_ID");
}

if (!openRouterKey) {
  missing.push("OPENROUTER_API_KEY");
}

if (missing.length > 0) {
  throw new Error(
    `❌ Missing environment variable(s): ${missing.join(", ")}`
  );
}

// =====================================================
// FALIX CONFIG
// =====================================================

const FALIX_API =
  "https://client.falixnodes.net/api/v2";

let powerActionRunning = false;

// =====================================================
// DISCORD CLIENT
// =====================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

// =====================================================
// HTTP SERVER
// =====================================================

const httpServer = http.createServer(
  (req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, {
        "Content-Type":
          "application/json; charset=utf-8"
      });

      res.end(
        JSON.stringify({
          status: "ok",
          service: "MoonShotSMP Bot",
          discord: client.isReady()
            ? "connected"
            : "connecting"
        })
      );

      return;
    }

    res.writeHead(200, {
      "Content-Type":
        "text/plain; charset=utf-8"
    });

    res.end(
      "MoonShotSMP Bot is online!"
    );
  }
);

httpServer.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `🌐 HTTP server listening on port ${PORT}`
    );
  }
);

// =====================================================
// SAFE VALUE GETTER
// =====================================================

function getValue(
  object,
  paths,
  fallback = "N/A"
) {
  for (const path of paths) {
    const parts =
      path.split(".");

    let value = object;

    for (const part of parts) {
      if (
        value === undefined ||
        value === null
      ) {
        value = undefined;
        break;
      }

      value = value[part];
    }

    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      return value;
    }
  }

  return fallback;
}

// =====================================================
// STRING TRUNCATE
// =====================================================

function truncate(
  value,
  maxLength,
  fallback = "N/A"
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  const text =
    String(value);

  if (
    text.length <= maxLength
  ) {
    return text;
  }

  return (
    text.slice(
      0,
      maxLength - 3
    ) + "..."
  );
}

// =====================================================
// FALIX API REQUEST
// =====================================================

async function falixRequest(
  endpoint,
  options = {}
) {
  const url =
    `${FALIX_API}${endpoint}`;

  console.log(
    "================================"
  );

  console.log(
    "🌐 FALIX API REQUEST"
  );

  console.log(
    "URL:",
    url
  );

  console.log(
    "Method:",
    options.method || "GET"
  );

  console.log(
    "================================"
  );

  let response;

  try {
    response = await fetch(
      url,
      {
        ...options,

        headers: {
          Authorization:
            `Bearer ${falixKey}`,

          Accept:
            "application/json",

          ...(options.body
            ? {
                "Content-Type":
                  "application/json"
              }
            : {}),

          ...(options.headers || {})
        }
      }
    );
  } catch (error) {
    console.error(
      "❌ Falix network error:"
    );

    console.error(error);

    const networkError =
      new Error(
        "Could not connect to Falix API."
      );

    networkError.code =
      "network_error";

    throw networkError;
  }

  const rawText =
    await response.text();

  let data = {};

  try {
    data =
      rawText
        ? JSON.parse(rawText)
        : {};
  } catch {
    data = {
      raw: rawText
    };
  }

  console.log(
    "================================"
  );

  console.log(
    "📡 FALIX API RESPONSE"
  );

  console.log(
    "HTTP STATUS:",
    response.status
  );

  console.log(
    "RESPONSE:",
    JSON.stringify(
      data,
      null,
      2
    )
  );

  console.log(
    "================================"
  );

  if (!response.ok) {
    const error =
      new Error(
        data?.error?.message ||
        data?.message ||
        (
          typeof data?.error ===
          "string"
            ? data.error
            : null
        ) ||
        `Falix API Error: ${response.status}`
      );

    error.httpStatus =
      response.status;

    error.code =
      data?.error?.code ||
      data?.code ||
      null;

    error.actionUrl =
      data?.error?.action_url ||
      data?.action_url ||
      null;

    error.docUrl =
      data?.error?.doc_url ||
      null;

    error.requestId =
      data?.error?.request_id ||
      data?.request_id ||
      response.headers.get(
        "x-request-id"
      ) ||
      null;

    error.response =
      data;

    throw error;
  }

  return data;
}

// =====================================================
// GET SERVER INFORMATION
// =====================================================

async function getServerInfo() {
  const response =
    await falixRequest(
      `/servers/${encodeURIComponent(
        serverId
      )}`
    );

  return response?.data || {};
}

// =====================================================
// GET SERVER STATUS
// =====================================================

async function getServerStatus() {
  const response =
    await falixRequest(
      `/servers/${encodeURIComponent(
        serverId
      )}/status`
    );

  return response?.data || {};
}

// =====================================================
// RAW SERVER STATE
// =====================================================

function getRawServerState(
  status
) {
  const state =
    getValue(
      status,
      [
        "state",
        "status",
        "server_state",
        "current_state",
        "lifecycle_status.state"
      ],
      "unknown"
    );

  return String(state)
    .toLowerCase()
    .trim();
}

// =====================================================
// STATE CHECK HELPERS
// =====================================================

function isOnlineState(
  state
) {
  return [
    "online",
    "running",
    "started"
  ].includes(state);
}

function isOfflineState(
  state
) {
  return [
    "offline",
    "stopped",
    "shutdown",
    "dead"
  ].includes(state);
}

function isStartingState(
  state
) {
  return [
    "starting",
    "booting",
    "queued",
    "installing"
  ].includes(state);
}

function isStoppingState(
  state
) {
  return [
    "stopping",
    "shutting_down"
  ].includes(state);
}

function isKnownState(
  state
) {
  return (
    isOnlineState(state) ||
    isOfflineState(state) ||
    isStartingState(state) ||
    isStoppingState(state)
  );
}

// =====================================================
// POWER SERVER
// =====================================================

async function powerServer(
  action
) {
  const validActions = [
    "start",
    "stop",
    "restart"
  ];

  if (
    !validActions.includes(action)
  ) {
    throw new Error(
      "Invalid server action."
    );
  }

  console.log(
    `⚡ Sending ${action.toUpperCase()} request to Falix...`
  );

  const idempotencyKey =
    `moonshotsmp-${serverId}-${action}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

  const result =
    await falixRequest(
      `/servers/${encodeURIComponent(
        serverId
      )}/power`,
      {
        method: "POST",

        headers: {
          "Idempotency-Key":
            idempotencyKey
        },

        body:
          JSON.stringify({
            signal: action
          })
      }
    );

  console.log(
    `✅ ${action.toUpperCase()} request accepted by Falix.`
  );

  return result;
}

// =====================================================
// SMART RESTART
// =====================================================

async function smartRestart() {
  console.log(
    "🔄 Checking server before restart..."
  );

  const status =
    await getServerStatus();

  const rawState =
    getRawServerState(status);

  console.log(
    "Current server state:",
    rawState
  );

  if (
    isOfflineState(rawState)
  ) {
    console.log(
      "🔴 Server offline. Using START."
    );

    return {
      actualAction: "start",

      result:
        await powerServer(
          "start"
        )
    };
  }

  if (
    isStartingState(rawState)
  ) {
    const error =
      new Error(
        "Server is already starting."
      );

    error.code =
      "already_starting";

    throw error;
  }

  if (
    isStoppingState(rawState)
  ) {
    const error =
      new Error(
        "Server is currently stopping."
      );

    error.code =
      "already_stopping";

    throw error;
  }

  if (
    !isKnownState(rawState)
  ) {
    const error =
      new Error(
        `Unknown Falix server state: ${rawState}`
      );

    error.code =
      "unknown_state";

    throw error;
  }

  return {
    actualAction:
      "restart",

    result:
      await powerServer(
        "restart"
      )
  };
}

// =====================================================
// FORMAT UPTIME
// =====================================================

function formatUptime(
  seconds
) {
  if (
    seconds === undefined ||
    seconds === null
  ) {
    return "N/A";
  }

  seconds =
    Math.floor(
      Number(seconds)
    );

  if (
    Number.isNaN(seconds) ||
    seconds < 0
  ) {
    return "N/A";
  }

  const days =
    Math.floor(
      seconds / 86400
    );

  seconds %= 86400;

  const hours =
    Math.floor(
      seconds / 3600
    );

  seconds %= 3600;

  const minutes =
    Math.floor(
      seconds / 60
    );

  const secs =
    seconds % 60;

  const parts = [];

  if (days > 0) {
    parts.push(
      `${days}d`
    );
  }

  if (hours > 0) {
    parts.push(
      `${hours}h`
    );
  }

  if (minutes > 0) {
    parts.push(
      `${minutes}m`
    );
  }

  if (
    parts.length === 0 ||
    secs > 0
  ) {
    parts.push(
      `${secs}s`
    );
  }

  return parts.join(" ");
}

// =====================================================
// SERVER STATE DISPLAY
// =====================================================

function getServerState(
  status
) {
  const state =
    getRawServerState(status);

  if (
    isOnlineState(state)
  ) {
    return {
      emoji: "🟢",
      text: "ONLINE",
      color: 0x57F287
    };
  }

  if (
    isStartingState(state)
  ) {
    return {
      emoji: "🟡",
      text: "STARTING",
      color: 0xFEE75C
    };
  }

  if (
    isStoppingState(state)
  ) {
    return {
      emoji: "🟠",
      text: "STOPPING",
      color: 0xFEE75C
    };
  }

  if (
    isOfflineState(state)
  ) {
    return {
      emoji: "🔴",
      text: "OFFLINE",
      color: 0xED4245
    };
  }

  return {
    emoji: "⚪",
    text: "UNKNOWN",
    color: 0x95A5A6
  };
}

// =====================================================
// PLAYER COUNT
// =====================================================

function getPlayerCount(
  status,
  server
) {
  let online =
    getValue(
      status,
      [
        "players.online",
        "players.current",
        "player_count"
      ],
      null
    );

  let max =
    getValue(
      status,
      [
        "players.max",
        "players.maximum",
        "max_players"
      ],
      null
    );

  if (
    online === null &&
    typeof status?.players ===
      "number"
  ) {
    online =
      status.players;
  }

  if (
    online === null &&
    typeof status?.players ===
      "object"
  ) {
    online =
      status.players.online ??
      status.players.current ??
      null;
  }

  if (
    max === null &&
    typeof status?.players ===
      "object"
  ) {
    max =
      status.players.max ??
      status.players.maximum ??
      null;
  }

  if (max === null) {
    max =
      getValue(
        server,
        [
          "players.max",
          "max_players"
        ],
        null
      );
  }

  const onlineNumber =
    Number(online);

  const maxNumber =
    Number(max);

  if (
    Number.isFinite(
      onlineNumber
    ) &&
    Number.isFinite(
      maxNumber
    )
  ) {
    return (
      `${onlineNumber} / ${maxNumber}`
    );
  }

  if (
    online !== null &&
    online !== undefined
  ) {
    return String(online);
  }

  return "N/A";
}

// =====================================================
// SERVER ADDRESS
// =====================================================

function getServerAddress(
  server
) {
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
    "N/A"
  );
}

// =====================================================
// BUILD SERVER PANEL
// =====================================================

async function buildPanel() {
  const [
    server,
    status
  ] = await Promise.all([
    getServerInfo(),
    getServerStatus()
  ]);

  const state =
    getServerState(status);

  const serverName =
    truncate(
      getValue(
        server,
        [
          "name",
          "server_name"
        ],
        "MoonShotSMP"
      ),
      200,
      "MoonShotSMP"
    );

  const version =
    truncate(
      getValue(
        server,
        [
          "version",
          "game.version",
          "software.version",
          "application.version"
        ],
        "N/A"
      ),
      100
    );

  const address =
    getServerAddress(server);

  const uptime =
    getValue(
      status,
      [
        "uptime",
        "uptime_seconds"
      ],
      null
    );

  let uptimeText =
    "Server is offline";

  if (
    state.text === "ONLINE"
  ) {
    uptimeText =
      formatUptime(uptime);
  } else if (
    state.text === "STARTING"
  ) {
    uptimeText =
      "Server is starting...";
  } else if (
    state.text === "STOPPING"
  ) {
    uptimeText =
      "Server is stopping...";
  } else if (
    state.text === "UNKNOWN"
  ) {
    uptimeText =
      "Status unavailable";
  }

  const safeAddress =
    truncate(
      String(address)
        .replace(/`/g, "'"),
      1000
    );

  const embed =
    new EmbedBuilder()
      .setColor(
        state.color
      )
      .setTitle(
        `🚀 ${serverName} Server Control Panel`
      )
      .setDescription(
        `${state.emoji} **${state.text}**\n` +
        `━━━━━━━━━━━━━━━━━━━━`
      )
      .addFields(
        {
          name:
            "👥 Player Count",

          value:
            `**${getPlayerCount(
              status,
              server
            )}**`,

          inline: true
        },

        {
          name:
            "🎮 Version",

          value:
            `**${version}**`,

          inline: true
        },

        {
          name:
            "⏱️ Uptime",

          value:
            `**${truncate(
              uptimeText,
              1000
            )}**`,

          inline: false
        },

        {
          name:
            "🌐 Connection Address",

          value:
            `\`${safeAddress}\``,

          inline: false
        }
      )
      .setFooter({
        text:
          "MoonShotSMP • Falix Minecraft Server"
      })
      .setTimestamp();

  const row =
    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()
          .setCustomId(
            "minecraft_start"
          )
          .setLabel("Start")
          .setEmoji("▶️")
          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()
          .setCustomId(
            "minecraft_stop"
          )
          .setLabel("Stop")
          .setEmoji("⏹️")
          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()
          .setCustomId(
            "minecraft_restart"
          )
          .setLabel("Restart")
          .setEmoji("🔄")
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            "minecraft_refresh"
          )
          .setLabel("Refresh")
          .setEmoji("🔃")
          .setStyle(
            ButtonStyle.Secondary
          )
      );

  return {
    embeds: [embed],
    components: [row]
  };
}

// =====================================================
// REFRESH PANEL MESSAGE
// =====================================================

async function refreshPanelMessage(
  message,
  delay = 0
) {
  if (delay > 0) {
    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          delay
        )
    );
  }

  try {
    const panel =
      await buildPanel();

    await message.edit(
      panel
    );

    console.log(
      "🔃 Panel refreshed."
    );

    return true;

  } catch (error) {
    console.error(
      "❌ Panel refresh failed:"
    );

    console.error(error);

    return false;
  }
}

// =====================================================
// OPENROUTER AI
// =====================================================

async function askAI(
  question
) {
  console.log(
    "🤖 Sending question to OpenRouter..."
  );

  let response;

  try {
    response =
      await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${openRouterKey}`,

            "Content-Type":
              "application/json",

            "HTTP-Referer":
              "https://discord.com/",

            "X-Title":
              "MoonShotSMP Discord Bot"
          },

          body:
            JSON.stringify({
              model:
                aiModel,

              messages: [
                {
                  role:
                    "system",

                  content:
                    "You are MoonShotSMP's Discord AI assistant. " +
                    "Be helpful, friendly and concise. " +
                    "Answer in casual Hinglish when appropriate. " +
                    "Do not claim to know live Minecraft server status " +
                    "unless the bot explicitly provides that information."
                },

                {
                  role:
                    "user",

                  content:
                    question
                }
              ],

              temperature:
                0.7,

              max_tokens:
                500
            })
        }
      );

  } catch (error) {
    console.error(
      "❌ OpenRouter network error:"
    );

    console.error(error);

    const networkError =
      new Error(
        "Could not connect to OpenRouter."
      );

    networkError.code =
      "openrouter_network_error";

    throw networkError;
  }

  const rawText =
    await response.text();

  let data = {};

  try {
    data =
      rawText
        ? JSON.parse(rawText)
        : {};
  } catch {
    data = {
      raw: rawText
    };
  }

  if (!response.ok) {
    console.error(
      "❌ OpenRouter error:"
    );

    console.error(
      JSON.stringify(
        data,
        null,
        2
      )
    );

    const error =
      new Error(
        data?.error?.message ||
        `OpenRouter returned HTTP ${response.status}`
      );

    error.httpStatus =
      response.status;

    error.code =
      data?.error?.code ||
      null;

    error.response =
      data;

    throw error;
  }

  const answer =
    data?.choices?.[0]?.message?.content;

  if (!answer) {
    throw new Error(
      "OpenRouter returned an empty response."
    );
  }

  console.log(
    "✅ OpenRouter response received."
  );

  return String(
    answer
  ).trim();
}

// =====================================================
// ANSWER QUESTION
// =====================================================

async function answerQuestion(
  question
) {
  const q =
    question
      .toLowerCase()
      .trim();

  // ===================================================
  // STATUS
  // ===================================================

  if (
    q.includes("status") ||
    q === "online" ||
    q.includes("server online") ||
    q.includes("is the server online")
  ) {
    try {
      const [
        server,
        status
      ] = await Promise.all([
        getServerInfo(),
        getServerStatus()
      ]);

      const state =
        getServerState(status);

      const players =
        getPlayerCount(
          status,
          server
        );

      return {
        title:
          "🎮 MoonShotSMP Server",

        description:
          `${state.emoji} **${state.text}**\n\n` +
          `👥 Players: **${players}**`
      };

    } catch (error) {
      console.error(
        "❌ Status request failed:"
      );

      console.error(error);

      return {
        title:
          "❌ Server Status",

        description:
          "I couldn't fetch the server status from Falix right now."
      };
    }
  }

  // ===================================================
  // IP
  // ===================================================

  if (
    q === "ip" ||
    q.includes("server ip") ||
    q.includes("server address") ||
    q.includes("minecraft ip") ||
    q.includes("how do i connect")
  ) {
    try {
      const server =
        await getServerInfo();

      const address =
        getServerAddress(
          server
        );

      return {
        title:
          "🌐 Minecraft Connection",

        description:
          `Server Address:\n\`${truncate(
            String(address),
            1000
          )}\``
      };

    } catch (error) {
      console.error(
        "❌ Address request failed:"
      );

      console.error(error);

      return {
        title:
          "❌ Connection Info",

        description:
          "I couldn't retrieve the server address."
      };
    }
  }

  // ===================================================
  // HELP
  // ===================================================

  if (
    q === "help" ||
    q === "commands" ||
    q.includes("what commands")
  ) {
    return {
      title:
        "🤖 MoonShotSMP Help",

      description:
        "**Available commands:**\n\n" +
        "`/panel` — Minecraft server control panel\n" +
        "`/ask` — Ask the AI assistant"
    };
  }

  // ===================================================
  // AI
  // ===================================================

  const aiAnswer =
    await askAI(
      question
    );

  return {
    title:
      "🤖 MoonShotSMP AI",

    description:
      aiAnswer
  };
}

// =====================================================
// REGISTER COMMANDS
// =====================================================

async function registerCommands() {
  const commands = [

    new SlashCommandBuilder()
      .setName("panel")
      .setDescription(
        "Show the Minecraft server control panel"
      )
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ManageGuild.toString()
      )
      .setDMPermission(false)
      .toJSON(),

    new SlashCommandBuilder()
      .setName("ask")
      .setDescription(
        "Ask the MoonShotSMP AI assistant"
      )
      .addStringOption(
        option =>
          option
            .setName("question")
            .setDescription(
              "Your question"
            )
            .setRequired(true)
            .setMaxLength(500)
      )
      .setDMPermission(false)
      .toJSON()
  ];

  const rest =
    new REST({
      version: "10"
    }).setToken(token);

  await rest.put(
    Routes.applicationCommands(
      client.user.id
    ),
    {
      body: commands
    }
  );

  console.log(
    "✅ Global /panel command registered."
  );

  console.log(
    "✅ Global /ask command registered."
  );
}

// =====================================================
// DISCORD READY
// =====================================================

client.once(
  "clientReady",
  async () => {

    console.log(
      "================================"
    );

    console.log(
      `🤖 Logged in as ${client.user.tag}`
    );

    console.log(
      `🎮 Falix Server ID: ${serverId}`
    );

    console.log(
      "🔐 Falix API: Configured"
    );

    console.log(
      `🤖 AI Model: ${aiModel}`
    );

    console.log(
      "================================"
    );

    try {
      await registerCommands();
    } catch (error) {
      console.error(
        "❌ Command registration failed:"
      );

      console.error(error);
    }
  }
);

// =====================================================
// INTERACTIONS
// =====================================================

client.on(
  "interactionCreate",
  async interaction => {

    try {

      // =================================================
      // SLASH COMMANDS
      // =================================================

      if (
        interaction.isChatInputCommand()
      ) {

        // ===============================================
        // PANEL
        // ===============================================

        if (
          interaction.commandName ===
          "panel"
        ) {

          if (
            !interaction.memberPermissions?.has(
              PermissionFlagsBits.ManageGuild
            )
          ) {
            await interaction.reply({
              content:
                "🔒 **You need Manage Server permission to use `/panel`.**",
              ephemeral: true
            });

            return;
          }

          await interaction.deferReply();

          try {
            const panel =
              await buildPanel();

            await interaction.editReply(
              panel
            );

          } catch (error) {
            console.error(
              "❌ Panel error:"
            );

            console.error(error);

            await interaction.editReply({
              content:
                "❌ **Failed to load server information from Falix.**"
            });
          }

          return;
        }

        // ===============================================
        // ASK
        // ===============================================

        if (
          interaction.commandName ===
          "ask"
        ) {

          const question =
            interaction.options.getString(
              "question",
              true
            );

          await interaction.deferReply();

          try {

            const answer =
              await answerQuestion(
                question
              );

            let description =
              answer.description ||
              "No response.";

            if (
              description.length >
              4096
            ) {
              description =
                description.slice(
                  0,
                  4090
                ) +
                "\n...";
            }

            const embed =
              new EmbedBuilder()
                .setColor(
                  0x5865F2
                )
                .setTitle(
                  truncate(
                    answer.title,
                    256,
                    "MoonShotSMP AI"
                  )
                )
                .setDescription(
                  description
                )
                .setFooter({
                  text:
                    truncate(
                      `MoonShotSMP AI • ${aiModel}`,
                      2048
                    )
                })
                .setTimestamp();

            await interaction.editReply({
              embeds: [embed]
            });

          } catch (error) {

            console.error(
              "❌ /ask error:"
            );

            console.error(error);

            let message =
              "❌ **AI request failed.**";

            if (
              error.httpStatus ===
              401
            ) {
              message =
                "❌ **OpenRouter API key is invalid or expired.**";

            } else if (
              error.httpStatus ===
              402
            ) {
              message =
                "❌ **The selected OpenRouter model/provider is currently unavailable for this request.**";

            } else if (
              error.httpStatus ===
              403
            ) {
              message =
                "🔒 **OpenRouter rejected the request. Check your API key permissions.**";

            } else if (
              error.httpStatus ===
              429
            ) {
              message =
                "⏳ **OpenRouter rate limit reached.**\nPlease try again later.";

            } else if (
              error.httpStatus >=
              500
            ) {
              message =
                "🔴 **OpenRouter is having a server-side problem.**";

            } else if (
              error.code ===
              "openrouter_network_error"
            ) {
              message =
                "🌐 **Could not connect to OpenRouter.**";
            }

            await interaction.editReply({
              content:
                `${message}\n\n` +
                `\`${truncate(
                  error.message ||
                  "Unknown error",
                  1000
                )}\``
            });
          }

          return;
        }

        return;
      }

      // =================================================
      // BUTTON CHECK
      // =================================================

      if (
        !interaction.isButton()
      ) {
        return;
      }

      // =================================================
      // BUTTON PERMISSION CHECK
      // =================================================

      if (
        !interaction.memberPermissions?.has(
          PermissionFlagsBits.ManageGuild
        )
      ) {
        await interaction.reply({
          content:
            "🔒 **You need Manage Server permission to use this control panel.**",
          ephemeral: true
        });

        return;
      }

      // =================================================
      // REFRESH
      // =================================================

      if (
        interaction.customId ===
        "minecraft_refresh"
      ) {

        await interaction.deferUpdate();

        try {

          const panel =
            await buildPanel();

          await interaction.message.edit(
            panel
          );

        } catch (error) {

          console.error(
            "❌ Refresh error:"
          );

          console.error(error);
        }

        return;
      }

      // =================================================
      // POWER ACTIONS
      // =================================================

      const actions = {
        minecraft_start:
          "start",

        minecraft_stop:
          "stop",

        minecraft_restart:
          "restart"
      };

      const action =
        actions[
          interaction.customId
        ];

      if (!action) {
        return;
      }

      // =================================================
      // DOUBLE REQUEST PROTECTION
      // =================================================

      if (
        powerActionRunning
      ) {
        await interaction.reply({
          content:
            "⏳ Another server power action is already running. Please wait.",
          ephemeral: true
        });

        return;
      }

      powerActionRunning =
        true;

      await interaction.deferReply({
        ephemeral: true
      });

      try {

        let actualAction =
          action;

        // =============================================
        // START
        // =============================================

        if (
          action === "start"
        ) {

          const status =
            await getServerStatus();

          const currentState =
            getRawServerState(
              status
            );

          console.log(
            "START requested. Current state:",
            currentState
          );

          if (
            isOnlineState(
              currentState
            )
          ) {
            await interaction.editReply({
              content:
                "🟢 **Server is already online.**"
            });

            return;
          }

          if (
            isStartingState(
              currentState
            )
          ) {
            await interaction.editReply({
              content:
                "🟡 **Server is already starting.**\n\nPlease wait for Falix."
            });

            return;
          }

          if (
            isStoppingState(
              currentState
            )
          ) {
            await interaction.editReply({
              content:
                "🟠 **Server is currently stopping.**\n\nWait for it to finish stopping."
            });

            return;
          }

          if (
            !isOfflineState(
              currentState
            )
          ) {
            await interaction.editReply({
              content:
                `⚪ **Falix returned an unknown server state:** \`${currentState}\`\n\nThe bot will not send a power request to avoid doing the wrong action.`
            });

            return;
          }

          await powerServer(
            "start"
          );
        }

        // =============================================
        // STOP
        // =============================================

        else if (
          action === "stop"
        ) {

          const status =
            await getServerStatus();

          const currentState =
            getRawServerState(
              status
            );

          console.log(
            "STOP requested. Current state:",
            currentState
          );

          if (
            isOfflineState(
              currentState
            )
          ) {
            await interaction.editReply({
              content:
                "🔴 **Server is already offline.**"
            });

            return;
          }

          if (
            isStoppingState(
              currentState
            )
          ) {
            await interaction.editReply({
              content:
                "🟠 **Server is already stopping.**"
            });

            return;
          }

          if (
            isStartingState(
              currentState
            )
          ) {
            await interaction.editReply({
              content:
                "🟡 **Server is currently starting.**\n\nWait until it finishes starting before stopping it."
            });

            return;
          }

          if (
            !isOnlineState(
              currentState
            )
          ) {
            await interaction.editReply({
              content:
                `⚪ **Falix returned an unknown server state:** \`${currentState}\`\n\nThe bot will not send a power request to avoid doing the wrong action.`
            });

            return;
          }

          await powerServer(
            "stop"
          );
        }

        // =============================================
        // RESTART
        // =============================================

        else if (
          action === "restart"
        ) {

          const restartResult =
            await smartRestart();

          actualAction =
            restartResult.actualAction;
        }

        // =============================================
        // SUCCESS
        // =============================================

        await interaction.editReply({
          content:
            `✅ **${actualAction.toUpperCase()}** request sent to Falix.\n\n` +
            `⏳ Checking server status...`
        });

        // =============================================
        // AUTO REFRESH
        // =============================================

        const panelMessage =
          interaction.message;

        setTimeout(
          async () => {
            await refreshPanelMessage(
              panelMessage
            );
          },
          5000
        );

        setTimeout(
          async () => {
            await refreshPanelMessage(
              panelMessage
            );
          },
          12000
        );

      } catch (error) {

        console.error(
          `❌ Failed to ${action} server`
        );

        console.error(
          "HTTP Status:",
          error.httpStatus ||
          "Unknown"
        );

        console.error(
          "Error Code:",
          error.code ||
          "Unknown"
        );

        console.error(
          "Message:",
          error.message ||
          "Unknown"
        );

        if (
          error.requestId
        ) {
          console.error(
            "Falix Request ID:",
            error.requestId
          );
        }

        if (
          error.response
        ) {
          console.error(
            "Falix Response:",
            JSON.stringify(
              error.response,
              null,
              2
            )
          );
        }

        let message =
          `❌ Failed to **${action}** the server.`;

        // =============================================
        // AD REQUIRED
        // =============================================

        if (
          error.code ===
          "ad_required"
        ) {

          message =
            "⚠️ **Falix requires an action before this server can be started.**\n\n" +
            "Complete the required Falix action, then press **Start** again.";

          if (
            error.actionUrl
          ) {
            message +=
              `\n\n🔗 ${error.actionUrl}`;
          }
        }

        // =============================================
        // FREE PLAN
        // =============================================

        else if (
          error.code ===
          "free_plan_restricted"
        ) {

          message =
            "⚠️ **This Falix power action is restricted on the current plan.**";
        }

        // =============================================
        // UNAUTHORIZED
        // =============================================

        else if (
          error.code ===
            "unauthorized" ||
          error.httpStatus ===
            401
        ) {

          message =
            "🔑 **Falix API key is invalid, expired, revoked, or missing permission.**";
        }

        // =============================================
        // ALREADY STARTING
        // =============================================

        else if (
          error.code ===
          "already_starting"
        ) {

          message =
            "🟡 **Server is already starting.**\n\n" +
            "Please wait for Falix to finish startup.";
        }

        // =============================================
        // ALREADY STOPPING
        // =============================================

        else if (
          error.code ===
          "already_stopping"
        ) {

          message =
            "🟠 **Server is currently stopping.**\n\n" +
            "Wait a few seconds and try again.";
        }

        // =============================================
        // UNKNOWN STATE
        // =============================================

        else if (
          error.code ===
          "unknown_state"
        ) {

          message =
            "⚪ **Falix returned an unknown server state.**\n\n" +
            `State: \`${truncate(
              error.message,
              500
            )}\``;
        }

        // =============================================
        // FORBIDDEN
        // =============================================

        else if (
          error.code ===
            "forbidden" ||
          error.httpStatus ===
            403
        ) {

          message =
            "🔒 **Falix rejected the request.**\n\n" +
            "Check that your API key has permission to control this server.";
        }

        // =============================================
        // SERVER SUSPENDED
        // =============================================

        else if (
          error.code ===
          "server_suspended"
        ) {

          message =
            "🚫 **This Falix server is suspended.**";
        }

        // =============================================
        // NOT FOUND
        // =============================================

        else if (
          error.code ===
            "not_found" ||
          error.httpStatus ===
            404
        ) {

          message =
            "❌ **Falix server was not found.**\n\n" +
            "Check `FALIX_SERVER_ID`.";
        }

        // =============================================
        // CONFLICT
        // =============================================

        else if (
          error.code ===
          "conflict"
        ) {

          message =
            "⚠️ **Falix rejected the action because the server is in a conflicting state.**";
        }

        // =============================================
        // RATE LIMIT
        // =============================================

        else if (
          error.code ===
            "rate_limit_exceeded" ||
          error.httpStatus ===
            429
        ) {

          message =
            "⏳ **Falix API rate limit reached.**\n\n" +
            "Please wait and try again.";
        }

        // =============================================
        // BAD REQUEST
        // =============================================

        else if (
          error.httpStatus ===
          400
        ) {

          message =
            `❌ **Falix rejected the ${action} request.**\n\n` +
            `Reason: \`${truncate(
              error.message,
              1000
            )}\``;
        }

        // =============================================
        // SERVER ERROR
        // =============================================

        else if (
          error.httpStatus >=
          500
        ) {

          message =
            "🔴 **Falix returned a server error.**\n\n" +
            "Try again later.";
        }

        // =============================================
        // NETWORK ERROR
        // =============================================

        else if (
          error.code ===
          "network_error"
        ) {

          message =
            "🌐 **Could not connect to Falix.**\n\n" +
            "Try again shortly.";
        }

        await interaction.editReply({
          content:
            message
        });

      } finally {

        powerActionRunning =
          false;
      }

      return;

    } catch (error) {

      console.error(
        "❌ Interaction handler error:"
      );

      console.error(error);

      try {

        if (
          interaction.deferred ||
          interaction.replied
        ) {

          await interaction.editReply({
            content:
              "❌ Something went wrong while processing this interaction."
          });

        } else {

          await interaction.reply({
            content:
              "❌ Something went wrong while processing this interaction.",
            ephemeral: true
          });
        }

      } catch {
        // Ignore secondary Discord errors.
      }

      powerActionRunning =
        false;
    }
  }
);

// =====================================================
// DISCORD ERROR
// =====================================================

client.on(
  "error",
  error => {
    console.error(
      "❌ Discord error:"
    );

    console.error(error);
  }
);

// =====================================================
// DISCORD WARNING
// =====================================================

client.on(
  "warn",
  warning => {
    console.warn(
      "⚠️ Discord warning:",
      warning
    );
  }
);

// =====================================================
// UNHANDLED REJECTION
// =====================================================

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "❌ Unhandled rejection:"
    );

    console.error(error);
  }
);

// =====================================================
// UNCAUGHT EXCEPTION
// =====================================================

process.on(
  "uncaughtException",
  error => {
    console.error(
      "❌ Uncaught exception:"
    );

    console.error(error);

    process.exit(1);
  }
);

// =====================================================
// GRACEFUL SHUTDOWN
// =====================================================

async function shutdown(
  signal
) {
  console.log(
    `🛑 Received ${signal}. Shutting down...`
  );

  try {
    httpServer.close();
  } catch {}

  try {
    client.destroy();
  } catch {}

  process.exit(0);
}

process.on(
  "SIGINT",
  () =>
    shutdown("SIGINT")
);

process.on(
  "SIGTERM",
  () =>
    shutdown("SIGTERM")
);

// =====================================================
// LOGIN
// =====================================================

console.log(
  "🔄 Connecting to Discord..."
);

client
  .login(token)
  .catch(error => {

    console.error(
      "❌ Discord login failed:"
    );

    console.error(error);

    process.exit(1);
  });
