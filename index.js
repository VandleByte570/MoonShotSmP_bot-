require("dotenv").config();

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

// =====================================================
// ENVIRONMENT VARIABLES
// =====================================================

const token = process.env.DISCORD_TOKEN;
const falixKey = process.env.FALIX_API_KEY;
const serverId = process.env.FALIX_SERVER_ID;

const openRouterKey =
  process.env.OPENROUTER_API_KEY;

const aiModel =
  process.env.AI_MODEL || "openrouter/free";

// =====================================================
// ENV VALIDATION
// =====================================================

if (!token) {
  throw new Error(
    "❌ DISCORD_TOKEN is missing."
  );
}

if (!falixKey) {
  throw new Error(
    "❌ FALIX_API_KEY is missing."
  );
}

if (!serverId) {
  throw new Error(
    "❌ FALIX_SERVER_ID is missing."
  );
}

if (!openRouterKey) {
  throw new Error(
    "❌ OPENROUTER_API_KEY is missing."
  );
}

// =====================================================
// RENDER HTTP SERVER
// =====================================================

const http = require("http");

const PORT =
  process.env.PORT || 10000;

http.createServer((req, res) => {

  res.writeHead(200, {
    "Content-Type": "text/plain"
  });

  res.end(
    "MoonShotSMP Bot is online!"
  );

}).listen(PORT, () => {

  console.log(
    `🌐 HTTP server running on port ${PORT}`
  );

});

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

    let value =
      object;

    for (const part of parts) {

      if (
        value === undefined ||
        value === null
      ) {

        value = undefined;
        break;
      }

      value =
        value[part];
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
    "Endpoint:",
    endpoint
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

    response =
      await fetch(url, {

        ...options,

        headers: {

          "Authorization":
            `Bearer ${falixKey}`,

          "Content-Type":
            "application/json",

          "Accept":
            "application/json",

          ...(options.headers || {})
        }

      });

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

        data?.error ||

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

function getRawServerState(status) {

  return String(

    getValue(
      status,
      [
        "state",
        "status",
        "server_state"
      ],
      "offline"
    )

  ).toLowerCase();
}

// =====================================================
// POWER SERVER
// =====================================================

async function powerServer(action) {

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

  const result =
    await falixRequest(

      `/servers/${encodeURIComponent(
        serverId
      )}/power`,

      {

        method: "POST",

        headers: {

          "Idempotency-Key":
            `${serverId}-${action}-${Date.now()}`

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
    [
      "offline",
      "stopped",
      "shutdown",
      "dead"
    ].includes(rawState)
  ) {

    console.log(
      "🔴 Server offline. Using START."
    );

    return {

      actualAction: "start",

      result:
        await powerServer("start")

    };
  }

  if (
    [
      "starting",
      "booting",
      "queued",
      "installing"
    ].includes(rawState)
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
    [
      "stopping",
      "shutting_down"
    ].includes(rawState)
  ) {

    const error =
      new Error(
        "Server is currently stopping."
      );

    error.code =
      "already_stopping";

    throw error;
  }

  return {

    actualAction: "restart",

    result:
      await powerServer("restart")

  };
}

// =====================================================
// FORMAT UPTIME
// =====================================================

function formatUptime(seconds) {

  if (
    seconds === undefined ||
    seconds === null
  ) {

    return "N/A";
  }

  seconds =
    Math.floor(Number(seconds));

  if (
    Number.isNaN(seconds)
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
// SERVER STATE
// =====================================================

function getServerState(status) {

  const state =
    getRawServerState(status);

  if (
    [
      "online",
      "running",
      "started"
    ].includes(state)
  ) {

    return {

      emoji: "🟢",

      text: "ONLINE",

      color: 0x57F287

    };
  }

  if (
    [
      "starting",
      "booting",
      "queued",
      "installing"
    ].includes(state)
  ) {

    return {

      emoji: "🟡",

      text: "STARTING",

      color: 0xFEE75C

    };
  }

  if (
    [
      "stopping",
      "shutting_down"
    ].includes(state)
  ) {

    return {

      emoji: "🟠",

      text: "STOPPING",

      color: 0xFEE75C

    };
  }

  return {

    emoji: "🔴",

    text: "OFFLINE",

    color: 0xED4245

  };
}

// =====================================================
// PLAYER COUNT
// =====================================================

function getPlayerCount(
  status,
  server
) {

  const online =
    getValue(

      status,

      [
        "players.online",
        "players.current",
        "player_count",
        "players"
      ],

      null

    );

  const max =
    getValue(

      status,

      [
        "players.max",
        "players.maximum",
        "max_players"
      ],

      getValue(

        server,

        [
          "players.max",
          "max_players"
        ],

        null

      )

    );

  if (
    typeof online === "number" &&
    typeof max === "number"
  ) {

    return `${online} / ${max}`;
  }

  if (
    online !== null &&
    online !== undefined &&
    online !== "N/A"
  ) {

    return String(online);
  }

  return "N/A";
}

// =====================================================
// BUILD PANEL
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
    getValue(

      server,

      [
        "name",
        "server_name"
      ],

      "MoonShotSMP"

    );

  const version =
    getValue(

      server,

      [
        "version",
        "game.version",
        "software.version",
        "application.version"
      ],

      "N/A"

    );

  const address =
    getValue(

      server,

      [
        "address",
        "connection.address",
        "allocation.address",
        "primary_allocation.address"
      ],

      "N/A"

    );

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

  }

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

          name: "👥 Player Count",

          value:
            `**${getPlayerCount(
              status,
              server
            )}**`,

          inline: true

        },

        {

          name: "🎮 Version",

          value:
            `**${version}**`,

          inline: true

        },

        {

          name: "⏱️ Uptime",

          value:
            `**${uptimeText}**`,

          inline: false

        },

        {

          name: "🌐 Connection Address",

          value:
            `\`${address}\``,

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

          .setLabel(
            "Start"
          )

          .setEmoji(
            "▶️"
          )

          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()

          .setCustomId(
            "minecraft_stop"
          )

          .setLabel(
            "Stop"
          )

          .setEmoji(
            "⏹️"
          )

          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()

          .setCustomId(
            "minecraft_restart"
          )

          .setLabel(
            "Restart"
          )

          .setEmoji(
            "🔄"
          )

          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()

          .setCustomId(
            "minecraft_refresh"
          )

          .setLabel(
            "Refresh"
          )

          .setEmoji(
            "🔃"
          )

          .setStyle(
            ButtonStyle.Secondary
          )

      );

  return {

    embeds: [
      embed
    ],

    components: [
      row
    ]

  };
}

// =====================================================
// OPENROUTER AI
// =====================================================

async function askAI(question) {

  console.log(
    "🤖 Sending question to OpenRouter..."
  );

  const response =
    await fetch(

      "https://openrouter.ai/api/v1/chat/completions",

      {

        method: "POST",

        headers: {

          "Authorization":
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

                role: "system",

                content:
                  "You are MoonShotSMP's Discord AI assistant. " +
                  "You are helpful, friendly and concise. " +
                  "Answer in casual Hinglish when appropriate. " +
                  "Do not claim to know live Minecraft server status " +
                  "unless it is provided by the bot."

              },

              {

                role: "user",

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

  const data =
    await response.json();

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

  return answer.trim();
}

// =====================================================
// /ASK RESPONSE
// =====================================================

async function answerQuestion(question) {

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

    } catch {

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
        getValue(

          server,

          [
            "address",
            "connection.address",
            "allocation.address",
            "primary_allocation.address"
          ],

          "N/A"

        );

      return {

        title:
          "🌐 Minecraft Connection",

        description:
          `Server Address:\n\`${address}\``

      };

    } catch {

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
    await askAI(question);

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

      .setName(
        "panel"
      )

      .setDescription(
        "Show the Minecraft server control panel"
      )

      .setDefaultMemberPermissions(
        PermissionFlagsBits.ManageGuild.toString()
      )

      .toJSON(),

    new SlashCommandBuilder()

      .setName(
        "ask"
      )

      .setDescription(
        "Ask the MoonShotSMP AI assistant"
      )

      .addStringOption(
        option =>
          option

            .setName(
              "question"
            )

            .setDescription(
              "Your question"
            )

            .setRequired(
              true
            )

            .setMaxLength(
              500
            )
      )

      .toJSON()

  ];

  const rest =
    new REST({
      version: "10"
    }).setToken(
      token
    );

  await rest.put(

    Routes.applicationCommands(
      client.user.id
    ),

    {
      body: commands
    }

  );

  console.log(
    "✅ /panel command registered."
  );

  console.log(
    "✅ /ask command registered."
  );
}

// =====================================================
// BOT READY
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
      `🎮 Server ID: ${serverId}`
    );

    console.log(
      "🔐 Falix API: Connected"
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
            "question"
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

          // Discord embed description limit
          if (
            description.length > 4096
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
                answer.title
              )

              .setDescription(
                description
              )

              .setFooter({

                text:
                  `MoonShotSMP AI • ${aiModel}`

              })

              .setTimestamp();

          await interaction.editReply({

            embeds: [
              embed
            ]

          });

        } catch (error) {

          console.error(
            "❌ /ask error:"
          );

          console.error(error);

          let message =
            "❌ **AI request failed.**";

          if (
            error.httpStatus === 401
          ) {

            message =
              "❌ **OpenRouter API key is invalid.**";

          } else if (
            error.httpStatus === 402
          ) {

            message =
              "❌ **OpenRouter rejected the request because the selected model/provider is not available for free right now.**";

          } else if (
            error.httpStatus === 429
          ) {

            message =
              "⏳ **OpenRouter free-model rate limit reached.**\nPlease try again later.";

          } else if (
            error.httpStatus >= 500
          ) {

            message =
              "🔴 **OpenRouter is currently having a server-side problem.**";

          }

          await interaction.editReply({

            content:
              `${message}\n\n` +
              `\`${error.message || "Unknown error"}\``

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

    if (powerActionRunning) {

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

      // ===============================================
      // START
      // ===============================================

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
          [
            "online",
            "running",
            "started"
          ].includes(currentState)
        ) {

          await interaction.editReply({

            content:
              "🟢 **Server is already online.**"

          });

          return;
        }

        if (
          [
            "starting",
            "booting",
            "queued",
            "installing"
          ].includes(currentState)
        ) {

          await interaction.editReply({

            content:
              "🟡 **Server is already starting.**\n\nPlease wait for Falix."

          });

          return;
        }

        await powerServer(
          "start"
        );
      }

      // ===============================================
      // STOP
      // ===============================================

      else if (
        action === "stop"
      ) {

        const status =
          await getServerStatus();

        const currentState =
          getRawServerState(
            status
          );

        if (
          [
            "offline",
            "stopped",
            "shutdown",
            "dead"
          ].includes(currentState)
        ) {

          await interaction.editReply({

            content:
              "🔴 **Server is already offline.**"

          });

          return;
        }

        await powerServer(
          "stop"
        );
      }

      // ===============================================
      // RESTART
      // ===============================================

      else if (
        action === "restart"
      ) {

        const restartResult =
          await smartRestart();

        actualAction =
          restartResult.actualAction;
      }

      // ===============================================
      // SUCCESS
      // ===============================================

      await interaction.editReply({

        content:

          `✅ **${actualAction.toUpperCase()}** request sent to Falix.\n\n` +

          `⏳ Checking server status...`

      });

      // ===============================================
      // AUTO REFRESH
      // ===============================================

      setTimeout(
        async () => {

          try {

            const panel =
              await buildPanel();

            await interaction.message.edit(
              panel
            );

            console.log(
              `🔃 Panel refreshed after ${actualAction}.`
            );

          } catch (error) {

            console.error(
              "❌ Automatic panel refresh failed:"
            );

            console.error(error);

          }

        },
        5000
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

      // ===============================================
      // AD REQUIRED
      // ===============================================

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

      // ===============================================
      // STARTING
      // ===============================================

      else if (
        error.code ===
        "already_starting"
      ) {

        message =

          "🟡 **Server is already starting.**\n\n" +

          "Please wait for Falix to finish startup.";

      }

      // ===============================================
      // STOPPING
      // ===============================================

      else if (
        error.code ===
        "already_stopping"
      ) {

        message =

          "🟠 **Server is currently stopping.**\n\n" +

          "Wait a few seconds and try again.";

      }

      // ===============================================
      // FORBIDDEN
      // ===============================================

      else if (
        error.code === "forbidden" ||
        error.httpStatus === 403
      ) {

        message =

          "🔒 **Falix rejected the request.**\n\n" +

          "Check your Falix API key permissions.";

      }

      // ===============================================
      // NOT FOUND
      // ===============================================

      else if (
        error.code === "not_found" ||
        error.httpStatus === 404
      ) {

        message =

          "❌ **Falix server was not found.**\n\n" +

          "Check `FALIX_SERVER_ID`.";

      }

      // ===============================================
      // RATE LIMIT
      // ===============================================

      else if (
        error.code ===
          "rate_limit_exceeded" ||
        error.httpStatus === 429
      ) {

        message =

          "⏳ **Falix API rate limit reached.**\n\n" +

          "Please wait and try again.";

      }

      // ===============================================
      // BAD REQUEST
      // ===============================================

      else if (
        error.httpStatus === 400
      ) {

        message =

          `❌ **Falix rejected the ${action} request.**\n\n` +

          `Reason: \`${error.message}\``;

      }

      // ===============================================
      // SERVER ERROR
      // ===============================================

      else if (
        error.httpStatus >= 500
      ) {

        message =

          "🔴 **Falix returned a server error.**\n\n" +

          "Try again later.";

      }

      // ===============================================
      // NETWORK ERROR
      // ===============================================

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

    console.error(
      error
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

    console.error(
      error
    );

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

    console.error(
      error
    );

  }
);

// =====================================================
// LOGIN
// =====================================================

console.log(
  "🔄 Connecting to Discord..."
);

client.login(token);
