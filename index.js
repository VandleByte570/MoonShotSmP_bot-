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

const {
  token,
  falixKey,
  serverId
} = require("./config");

// =====================================================
// RENDER HTTP SERVER
// =====================================================

const http = require("http");

const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain"
  });

  res.end("MoonShotSMP Bot is online!");
}).listen(PORT, () => {
  console.log(`🌐 HTTP server running on port ${PORT}`);
});

// =====================================================
// FALIX CONFIG
// =====================================================

const FALIX_API =
  "https://client.falixnodes.net/api/v2";

// Prevent accidental double power requests
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
// FALIX API REQUEST
// =====================================================

async function falixRequest(endpoint, options = {}) {

  const url = `${FALIX_API}${endpoint}`;

  console.log("================================");
  console.log("🌐 FALIX API REQUEST");
  console.log("Endpoint:", endpoint);
  console.log("Method:", options.method || "GET");
  console.log("================================");

  let response;

  try {

    response = await fetch(url, {
      ...options,

      headers: {
        "Authorization": `Bearer ${falixKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...(options.headers || {})
      }
    });

  } catch (error) {

    console.error("❌ Falix network error:");
    console.error(error);

    const networkError =
      new Error("Could not connect to Falix API.");

    networkError.code =
      "network_error";

    throw networkError;
  }

  const rawText =
    await response.text();

  let data = {};

  try {

    data = rawText
      ? JSON.parse(rawText)
      : {};

  } catch {

    data = {
      raw: rawText
    };

  }

  // ===================================================
  // LOG RESPONSE
  // ===================================================

  console.log("================================");
  console.log("📡 FALIX API RESPONSE");
  console.log("HTTP STATUS:", response.status);
  console.log(
    "RESPONSE:",
    JSON.stringify(data, null, 2)
  );
  console.log("================================");

  // ===================================================
  // ERROR
  // ===================================================

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
      `/servers/${encodeURIComponent(serverId)}`
    );

  return response?.data || {};
}

// =====================================================
// GET SERVER STATUS
// =====================================================

async function getServerStatus() {

  const response =
    await falixRequest(
      `/servers/${encodeURIComponent(serverId)}/status`
    );

  return response?.data || {};
}

// =====================================================
// GET RAW SERVER STATE
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

  if (!validActions.includes(action)) {

    throw new Error(
      "Invalid server action."
    );
  }

  console.log(
    `⚡ Sending ${action.toUpperCase()} request to Falix...`
  );

  const result =
    await falixRequest(
      `/servers/${encodeURIComponent(serverId)}/power`,
      {
        method: "POST",

        headers: {
          "Idempotency-Key":
            `${serverId}-${action}-${Date.now()}`
        },

        body: JSON.stringify({
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

  // If already offline, restart signal may fail.
  // Start it instead.
  if (
    [
      "offline",
      "stopped",
      "shutdown",
      "dead"
    ].includes(rawState)
  ) {

    console.log(
      "🔴 Server is offline. Using START instead of RESTART."
    );

    return {
      actualAction: "start",
      result:
        await powerServer("start")
    };
  }

  // If starting/booting, don't send another request.
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

  // If stopping, wait briefly before restarting.
  if (
    [
      "stopping",
      "shutting_down"
    ].includes(rawState)
  ) {

    const error =
      new Error(
        "Server is currently stopping. Try restart again in a few seconds."
      );

    error.code =
      "already_stopping";

    throw error;
  }

  // Normal online restart
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

  if (Number.isNaN(seconds)) {
    return "N/A";
  }

  const days =
    Math.floor(seconds / 86400);

  seconds %= 86400;

  const hours =
    Math.floor(seconds / 3600);

  seconds %= 3600;

  const minutes =
    Math.floor(seconds / 60);

  const secs =
    seconds % 60;

  const parts = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }

  if (
    parts.length === 0 ||
    secs > 0
  ) {
    parts.push(`${secs}s`);
  }

  return parts.join(" ");
}

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

        value =
          undefined;

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

  // ===================================================
  // EMBED
  // ===================================================

  const embed =
    new EmbedBuilder()
      .setColor(state.color)

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

  // ===================================================
  // BUTTONS
  // ===================================================

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
// /ASK RESPONSE
// =====================================================

async function answerQuestion(question) {

  const q =
    question.toLowerCase();

  // Server status
  if (
    q.includes("status") ||
    q.includes("online") ||
    q.includes("server")
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
        title: "🎮 MoonShotSMP Server",
        description:
          `${state.emoji} **${state.text}**\n\n` +
          `👥 Players: **${players}**`
      };

    } catch {

      return {
        title: "❌ Server Status",
        description:
          "I couldn't fetch the server status from Falix right now."
      };
    }
  }

  // IP
  if (
    q.includes("ip") ||
    q.includes("address") ||
    q.includes("connect")
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
        title: "🌐 Minecraft Connection",
        description:
          `Server Address:\n\`${address}\``
      };

    } catch {

      return {
        title: "❌ Connection Info",
        description:
          "I couldn't retrieve the server address."
      };
    }
  }

  // Start
  if (
    q.includes("start") ||
    q.includes("open")
  ) {

    return {
      title: "▶️ Starting the Server",
      description:
        "Use the **Start** button in `/panel` to start the server."
    };
  }

  // Stop
  if (
    q.includes("stop") ||
    q.includes("shutdown")
  ) {

    return {
      title: "⏹️ Stopping the Server",
      description:
        "Use the **Stop** button in `/panel` to stop the server."
    };
  }

  // Restart
  if (
    q.includes("restart") ||
    q.includes("reboot")
  ) {

    return {
      title: "🔄 Restarting the Server",
      description:
        "Use the **Restart** button in `/panel` to restart the server."
    };
  }

  // Help
  if (
    q.includes("help") ||
    q.includes("command") ||
    q.includes("commands")
  ) {

    return {
      title: "🤖 MoonShotSMP Help",
      description:
        "**Available commands:**\n\n" +
        "`/panel` — Minecraft server control panel\n" +
        "`/ask` — Ask me a server-related question"
    };
  }

  // Default
  return {
    title: "🤖 MoonShotSMP Assistant",
    description:
      "I can help with:\n\n" +
      "• Server status\n" +
      "• Minecraft IP\n" +
      "• Starting the server\n" +
      "• Stopping the server\n" +
      "• Restarting the server\n" +
      "• Bot commands\n\n" +
      "Try asking something like **\"What's the server status?\"**"
  };
}

// =====================================================
// REGISTER SLASH COMMANDS
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
      .toJSON(),

    new SlashCommandBuilder()
      .setName("ask")
      .setDescription(
        "Ask the MoonShotSMP assistant a question"
      )
      .addStringOption(option =>
        option
          .setName("question")
          .setDescription(
            "Your question"
          )
          .setRequired(true)
          .setMaxLength(500)
      )
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
      // /PANEL
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
      // /ASK
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

          const embed =
            new EmbedBuilder()
              .setColor(0x5865F2)
              .setTitle(answer.title)
              .setDescription(answer.description)
              .setFooter({
                text:
                  "MoonShotSMP Assistant"
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

          await interaction.editReply({
            content:
              "❌ Something went wrong while answering your question."
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
    // PREVENT DOUBLE REQUESTS
    // =================================================

    if (powerActionRunning) {

      await interaction.reply({
        content:
          "⏳ Another server power action is already running. Please wait a moment.",
        ephemeral: true
      });

      return;
    }

    powerActionRunning = true;

    // =================================================
    // DEFER
    // =================================================

    await interaction.deferReply({
      ephemeral: true
    });

    try {

      let actualAction =
        action;

      // =================================================
      // START
      // =================================================

      if (
        action === "start"
      ) {

        const status =
          await getServerStatus();

        const currentState =
          getRawServerState(status);

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

          powerActionRunning =
            false;

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

          powerActionRunning =
            false;

          await interaction.editReply({
            content:
              "🟡 **Server is already starting.**\n\nPlease wait for Falix to finish starting it."
          });

          return;
        }

        await powerServer(
          "start"
        );
      }

      // =================================================
      // STOP
      // =================================================

      else if (
        action === "stop"
      ) {

        const status =
          await getServerStatus();

        const currentState =
          getRawServerState(status);

        if (
          [
            "offline",
            "stopped",
            "shutdown",
            "dead"
          ].includes(currentState)
        ) {

          powerActionRunning =
            false;

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

      // =================================================
      // SMART RESTART
      // =================================================

      else if (
        action === "restart"
      ) {

        const restartResult =
          await smartRestart();

        actualAction =
          restartResult.actualAction;
      }

      // =================================================
      // SUCCESS
      // =================================================

      await interaction.editReply({

        content:
          `✅ **${actualAction.toUpperCase()}** request sent to Falix.\n\n` +
          `⏳ Checking server status...`

      });

      // =================================================
      // REFRESH PANEL
      // =================================================

      setTimeout(
        async () => {

          try {

            const panel =
              await buildPanel();

            await interaction.message.edit(
              panel
            );

            console.log(
              `🔃 Panel automatically refreshed after ${actualAction}.`
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
        error.httpStatus || "Unknown"
      );

      console.error(
        "Error Code:",
        error.code || "Unknown"
      );

      console.error(
        "Message:",
        error.message || "Unknown"
      );

      if (error.response) {

        console.error(
          "Falix Response:",
          JSON.stringify(
            error.response,
            null,
            2
          )
        );
      }

      // =================================================
      // DEFAULT ERROR
      // =================================================

      let message =
        `❌ Failed to **${action}** the server.`;

      // =================================================
      // AD REQUIRED
      // =================================================

      if (
        error.code ===
        "ad_required"
      ) {

        message =
          "⚠️ **Falix requires an action before this server can be started.**\n\n" +
          "Falix has required an additional browser action for this free server.";

        if (error.actionUrl) {

          message +=
            `\n\n🔗 **Complete the required action:**\n${error.actionUrl}\n\n` +
            "After completing it, press **Start** again.";
        } else {

          message +=
            "\n\nComplete the required Falix action and then press **Start** again.";
        }
      }

      // =================================================
      // ALREADY STARTING
      // =================================================

      else if (
        error.code ===
        "already_starting"
      ) {

        message =
          "🟡 **Server is already starting.**\n\n" +
          "Please wait until Falix finishes the startup.";
      }

      // =================================================
      // ALREADY STOPPING
      // =================================================

      else if (
        error.code ===
        "already_stopping"
      ) {

        message =
          "🟠 **Server is currently stopping.**\n\n" +
          "Wait a few seconds and try again.";
      }

      // =================================================
      // FORBIDDEN
      // =================================================

      else if (
        error.code ===
        "forbidden" ||
        error.httpStatus === 403
      ) {

        message =
          "🔒 **Falix rejected the request.**\n\n" +
          "Check that your API key has permission to control this server.";
      }

      // =================================================
      // NOT FOUND
      // =================================================

      else if (
        error.code ===
        "not_found" ||
        error.httpStatus === 404
      ) {

        message =
          "❌ **Falix server was not found.**\n\n" +
          "Check your `FALIX_SERVER_ID`.";
      }

      // =================================================
      // RATE LIMIT
      // =================================================

      else if (
        error.code ===
        "rate_limit_exceeded" ||
        error.httpStatus === 429
      ) {

        message =
          "⏳ **Falix API rate limit reached.**\n\n" +
          "Please wait and try again.";
      }

      // =================================================
      // BAD REQUEST
      // =================================================

      else if (
        error.httpStatus === 400
      ) {

        message =
          `❌ **Falix rejected the ${action} request.**\n\n` +
          `Reason: \`${error.message}\``;
      }

      // =================================================
      // SERVER ERROR
      // =================================================

      else if (
        error.httpStatus >= 500
      ) {

        message =
          "🔴 **Falix is currently returning a server error.**\n\n" +
          "Try again in a little while.";
      }

      // =================================================
      // NETWORK ERROR
      // =================================================

      else if (
        error.code ===
        "network_error"
      ) {

        message =
          "🌐 **Could not connect to Falix.**\n\n" +
          "Check Falix status or try again shortly.";
      }

      await interaction.editReply({
        content: message
      });

    } finally {

      powerActionRunning =
        false;
    }

  }
);

// =====================================================
// DISCORD ERROR HANDLING
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

  }
);

// =====================================================
// LOGIN
// =====================================================

console.log(
  "🔄 Connecting to Discord..."
);

client.login(token);
